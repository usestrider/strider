# Security

Report a vulnerability privately through
[GitHub's advisory form](https://github.com/usestrider/strider/security/advisories/new), not in a public issue. Say
what an attacker can do, which version it affects, and how to reproduce it.

Strider is pre-release, so fixes go into the latest published version only.

Strider gives whoever runs it control of a browser. A program that drives a page can already run scripts in it and read
its cookies and storage, so that alone isn't a vulnerability. Examples of what is:

- A page reaching the machine or the browser's other pages through Strider, beyond what the program asked for.
- Another local user taking over the `strider` daemon through its session files or socket.

The CLI protects session files with Unix ownership and private directory permissions. This does not isolate
processes running as the same user, privileged processes, or browser debugging TCP ports. Chromium uses inherited
pipes by default; its port mode, Firefox BiDi and stock WebKit use loopback debugging listeners. Filesystem
permissions do not authenticate clients of those ports. Use a trusted local machine or OS/network isolation
when using those transports. Report bypasses of the daemon filesystem boundary privately as above; this
transport limitation does not exempt daemon takeover from vulnerability reporting.
