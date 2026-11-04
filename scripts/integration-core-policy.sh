#!/usr/bin/env bash
# Temporary, opt-in comparison on a disposable GitHub-hosted runner. No browser options change.
set -euo pipefail
mode=${1:-control}
shift
if [[ "$mode" != control && "$mode" != respect-limit ]]; then
  echo "Unknown core-policy comparison mode: $mode" >&2
  exit 2
fi
if [[ ${1:-} != -- || $# -lt 2 ]]; then
  echo 'Usage: integration-core-policy.sh control|respect-limit -- command [args...]' >&2
  exit 2
fi
shift
expected='|/usr/lib/systemd/systemd-coredump %P %u %g %s %t 9223372036854775808 %h %d'
treatment='|/usr/lib/systemd/systemd-coredump %P %u %g %s %t %c %h %d'
original=$(cat /proc/sys/kernel/core_pattern) || {
  [[ "$mode" == control ]] || exit 1
  original='<unavailable>'
}
printf 'core-policy mode=%s before=%s\n' "$mode" "$original"
systemd --version || { [[ "$mode" == control ]] || exit 1; }
if [[ "$mode" == respect-limit ]]; then
  if [[ ${GITHUB_ACTIONS:-} != true || ${RUNNER_ENVIRONMENT:-} != github-hosted || ${RUNNER_OS:-} != Linux || ${GITHUB_EVENT_NAME:-} != workflow_dispatch ]]; then
    echo 'Treatment requires a manual workflow on a disposable GitHub-hosted Linux runner' >&2
    exit 2
  fi
  if [[ "$original" != "$expected" ]]; then
    echo 'Refusing to change an unexpected core_pattern' >&2
    exit 2
  fi
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
if [[ "$mode" == respect-limit ]]; then
  # Register restoration before attempting the write, including a write with an uncertain outcome.
  changed=true
  sudo -n sysctl --write "kernel.core_pattern=$treatment"
  actual=$(cat /proc/sys/kernel/core_pattern)
  printf 'core-policy treatment=%s\n' "$actual"
  [[ "$actual" == "$treatment" ]] || { echo 'Treatment verification failed' >&2; exit 1; }
fi
"$@" &
child=$!
set +e
wait "$child"
result=$?
set -e
exit "$result"
