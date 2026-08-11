# Security policy

This project is experimental. Do not use it as a security boundary for untrusted plugin code.

Please report suspected vulnerabilities privately through GitHub's security-advisory flow for this
repository. Include the affected version, a minimal reproduction, impact, and any proposed
mitigation. Do not include production data or credentials.

The project aims to maintain strict-CSP compatibility, avoid `eval` and unsafe HTML, validate all
persisted or remote data at trust boundaries, bound resource use, and keep diagnostics redacted by
default. Dynamic plugins, cross-origin messages, and remote surface protocols are not supported in
0.1.
