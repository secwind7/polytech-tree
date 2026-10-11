#!/usr/bin/env bash
# 对已构建的镜像做运行时检查。用法：bash docker/smoke.sh polytech-tree:ci
set -euo pipefail

IMAGE="${1:-polytech-tree:local}"
PORT="${PORT:-18080}"
NAME="polytech-tree-smoke-$$"
TMP="$(mktemp -d)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  docker logs "$NAME" >&2 || true
  exit 1
}

echo "== runtime image has no build tools =="
if docker run --rm --entrypoint sh "$IMAGE" -c 'command -v node >/dev/null || command -v npm >/dev/null || command -v python3 >/dev/null'; then
  fail "node, npm, or python3 is present in the runtime image"
fi
docker run --rm --entrypoint sh "$IMAGE" -c 'test -s /usr/share/nginx/html/index.html && test -d /usr/share/nginx/html/assets'

user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")"
case "$user" in
  nginx|101) ;;
  *) fail "image user is '$user', expected nginx or 101" ;;
esac

echo "== start read-only, no capabilities =="
docker run -d --name "$NAME" \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -p "127.0.0.1:${PORT}:8080" \
  "$IMAGE" >/dev/null

uid="$(docker exec "$NAME" id -u)"
[ "$uid" = "101" ] || fail "process uid is $uid, expected 101"
if docker exec "$NAME" touch /usr/share/nginx/html/nope >/dev/null 2>&1; then
  fail "document root is writable"
fi

echo "== healthcheck =="
status=""
for _ in $(seq 1 20); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$NAME")"
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "$status" = "healthy" ] || fail "health status is $status"

health_code="$(curl -sS -o "$TMP/health" -w '%{http_code}' "http://127.0.0.1:${PORT}/healthz")"
[ "$health_code" = "200" ] || fail "healthz status $health_code"
printf 'ok\n' > "$TMP/health.expected"
cmp -s "$TMP/health" "$TMP/health.expected" || fail "healthz body mismatch"

echo "== index, assets, headers =="
curl -fsS -D "$TMP/index.hdr" -o "$TMP/index.html" "http://127.0.0.1:${PORT}/"
grep -q '人类科技树' "$TMP/index.html" || fail "index missing title"
grep -q 'id="app"' "$TMP/index.html" || fail "index missing app root"
grep -qi '^cache-control: no-cache' "$TMP/index.hdr" || fail "index is cacheable: $(grep -i '^cache-control:' "$TMP/index.hdr" || true)"
grep -qi '^x-content-type-options: nosniff' "$TMP/index.hdr" || fail "missing nosniff on index"
grep -qi '^x-frame-options: SAMEORIGIN' "$TMP/index.hdr" || fail "missing frame options on index"
grep -qi '^content-security-policy:' "$TMP/index.hdr" || fail "missing CSP on index"
grep -qi "^content-security-policy:.*script-src 'self'" "$TMP/index.hdr" || fail "CSP does not lock scripts to self"
if grep -qi '^server: nginx/' "$TMP/index.hdr"; then
  fail "nginx version leaked: $(grep -i '^server:' "$TMP/index.hdr")"
fi

js="$(grep -oE '\./assets/[^"]+\.js' "$TMP/index.html" | head -1)"
css="$(grep -oE '\./assets/[^"]+\.css' "$TMP/index.html" | head -1)"
[ -n "$js" ] || fail "no js asset in index"
[ -n "$css" ] || fail "no css asset in index"
js_path="${js#./}"
css_path="${css#./}"

curl -fsS -D "$TMP/js.hdr" -o "$TMP/app.js" "http://127.0.0.1:${PORT}/${js_path}"
grep -q 'Control of fire by early humans' "$TMP/app.js" || fail "bundle is missing tech data"
grep -qi '^content-type: .*javascript' "$TMP/js.hdr" || fail "js content-type: $(grep -i '^content-type:' "$TMP/js.hdr" || true)"
grep -qi '^cache-control: public, max-age=31536000, immutable' "$TMP/js.hdr" || fail "js cache header: $(grep -i '^cache-control:' "$TMP/js.hdr" || true)"
grep -qi '^x-content-type-options: nosniff' "$TMP/js.hdr" || fail "missing nosniff on js"

curl -fsS -D "$TMP/css.hdr" -o /dev/null "http://127.0.0.1:${PORT}/${css_path}"
grep -qi '^content-type: text/css' "$TMP/css.hdr" || fail "css content-type: $(grep -i '^content-type:' "$TMP/css.hdr" || true)"
grep -qi '^cache-control: public, max-age=31536000, immutable' "$TMP/css.hdr" || fail "css cache header"

curl -fsS -D "$TMP/gz.hdr" -o /dev/null -H 'Accept-Encoding: gzip' "http://127.0.0.1:${PORT}/${js_path}"
grep -qi '^content-encoding: gzip' "$TMP/gz.hdr" || fail "js was not gzipped"

echo "== missing paths =="
missing_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/not-a-page")"
[ "$missing_code" = "404" ] || fail "unknown path status $missing_code, expected 404"
asset_miss="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/assets/missing.js")"
[ "$asset_miss" = "404" ] || fail "missing asset status $asset_miss, expected 404"
hidden_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/.env")"
[ "$hidden_code" = "403" ] || fail "hidden path status $hidden_code, expected 403"

echo "== sigterm =="
docker stop -t 10 "$NAME" >/dev/null

echo "PASS $IMAGE"
