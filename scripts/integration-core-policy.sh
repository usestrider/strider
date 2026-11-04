#!/usr/bin/env bash
# Respect process core limits on disposable GitHub-hosted Integration runners.
# The hosted handler receives a fixed huge limit; %c passes the actual process limit
# so renderer core dumps do not outlast the crash tests’ deadlines.
set -euo pipefail
if [[ ${1:-} != -- || $# -lt 2 ]]; then
  echo 'Usage: integration-core-policy.sh -- command [args...]' >&2
  exit 2
fi
shift
expected='|/usr/lib/systemd/systemd-coredump %P %u %g %s %t 9223372036854775808 %h %d'
treatment='|/usr/lib/systemd/systemd-coredump %P %u %g %s %t %c %h %d'
original=$(cat /proc/sys/kernel/core_pattern)
printf 'core-policy before=%s\n' "$original"
systemd --version
if [[ ${GITHUB_ACTIONS:-} != true || ${RUNNER_ENVIRONMENT:-} != github-hosted || ${RUNNER_OS:-} != Linux || ( ${GITHUB_EVENT_NAME:-} != workflow_dispatch && ${GITHUB_EVENT_NAME:-} != schedule ) ]]; then
  echo 'Core policy requires a scheduled or manual workflow on a disposable GitHub-hosted Linux runner' >&2
  exit 2
fi
if [[ "$original" != "$expected" ]]; then
  echo 'Refusing to change an unexpected core_pattern' >&2
  exit 2
fi
changed=false
child=''
# Invoked by EXIT; also exercised by CorePolicy.test.ts.
# shellcheck disable=SC2329
restore() {
  local result=$?
  trap - EXIT
  if [[ "$changed" == true ]]; then
    if ! sudo -n sysctl --write "kernel.core_pattern=$original"; then
      echo 'ERROR: original core_pattern could not be restored' >&2
      [[ "$result" != 0 ]] || result=1
    fi
  fi
  local after
  after=$(cat /proc/sys/kernel/core_pattern) || after='<unavailable>'
  printf 'core-policy exit=%s restored=%s\n' "$result" "$after"
  if [[ "$changed" == true && "$after" != "$original" ]]; then
    echo 'ERROR: restored core_pattern does not match original' >&2
    [[ "$result" != 0 ]] || result=1
  fi
  exit "$result"
}
# Invoked by signal traps; also exercised by CorePolicy.test.ts.
# shellcheck disable=SC2329
interrupt() {
  local signal=$1 result=$2
  if [[ -n "$child" ]]; then kill -s "$signal" "$child" 2>/dev/null || true; fi
  exit "$result"
}
trap restore EXIT
trap 'interrupt INT 130' INT
trap 'interrupt TERM 143' TERM
trap 'interrupt HUP 129' HUP
# Register restoration before attempting the write, including a write with an uncertain outcome.
changed=true
sudo -n sysctl --write "kernel.core_pattern=$treatment"
actual=$(cat /proc/sys/kernel/core_pattern)
printf 'core-policy applied=%s\n' "$actual"
[[ "$actual" == "$treatment" ]] || { echo 'Policy verification failed' >&2; exit 1; }
"$@" &
child=$!
set +e
wait "$child"
result=$?
set -e
exit "$result"
