# Security

Report a vulnerability privately through
[GitHub's advisory form](https://github.com/usestrider/strider/security/advisories/new), not in a public issue. Say
what an attacker can do, which version it affects, and how to reproduce it.

Strider is pre-release, so fixes go into the latest published version only.

Strider gives whoever runs it control of a browser. A program that drives a page can already run scripts in it and read
its cookies and storage, so that alone isn't a vulnerability. Examples of what is:

- A page reaching the machine or the browser's other pages through Strider, beyond what the program asked for.
- Another local user or process taking over the `strider` daemon or a browser it launched.
