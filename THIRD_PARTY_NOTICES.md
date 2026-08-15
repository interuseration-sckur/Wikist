# Third-Party Notices

Wikist depends on open-source packages whose complete license texts are shipped by their package managers under `webman-backend/vendor/`, `node_modules/`, plugin vendor directories, or the corresponding optional runtime distribution.

## League CommonMark

`league/commonmark` 2.9.1 is licensed under BSD-3-Clause and provides the server-side CommonMark/GFM parsing base used by Wikist Native Community. Wikist applies its own safe configuration and knowledge/math extensions around that parser.

## Webman And Illuminate Database

- `workerman/webman-framework` 2.2.3: MIT License.
- `illuminate/database` 13.24.0: MIT License.

The exact dependency versions and transitive packages are recorded in `webman-backend/composer.lock` and `package-lock.json` where applicable. Those lockfiles, package metadata, and bundled license files are authoritative for an installed release.
