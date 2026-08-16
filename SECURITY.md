# Wikist Security

## Reporting

Please report suspected vulnerabilities privately through the repository's GitHub Security Advisory page. Do not publish credentials, private user data, exploit payloads, or unredacted production logs in a public issue.

Include the affected version, deployment mode, reproduction steps, impact, and the smallest practical proof of concept. Maintainers should acknowledge a complete report within seven days and coordinate disclosure after a fix is available.

## Supported Version

Security fixes target the latest stable Wikist release. Administrators should keep PHP, Node.js, Composer dependencies, npm dependencies, the reverse proxy, and the operating system updated.

## Deployment Baseline

- Keep the legacy Node compatibility listener bound to loopback only.
- Use HTTPS, a strong `APP_SECRET`, explicit trusted origins and trusted proxy CIDRs.
- Store signing keys and SMTP credentials outside the repository.
- Run `npm run doctor`, create a verified backup, and apply updates with the bundled updater.
- Review third-party plugin source before enabling client execution.
