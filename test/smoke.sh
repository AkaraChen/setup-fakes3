#!/bin/sh
# test/smoke.sh ENDPOINT ACCESS_KEY SECRET_KEY
# A signed round trip through a running fakes3 (create a bucket, put, get, list), using curl's SigV4.
set -eu
endpoint=$1
user=$2:$3
bucket=smoke-$$

s3() {
  curl -sS --fail-with-body --aws-sigv4 aws:amz:us-east-1:s3 --user "$user" "$@"
}

s3 -X PUT "$endpoint/$bucket" -o /dev/null
printf hello | s3 -X PUT --data-binary @- "$endpoint/$bucket/hello.txt" -o /dev/null
test "$(s3 "$endpoint/$bucket/hello.txt")" = hello
s3 "$endpoint/$bucket?list-type=2" | grep -q '<Key>hello.txt</Key>'
echo "smoke test passed: $endpoint as $2"
