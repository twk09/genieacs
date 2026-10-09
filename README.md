# GenieACS

This repository is a fork of the original [GenieACS project](https://github.com/genieacs/genieacs).
It preserves the upstream project and license while adding deployment-specific
development; changes here may diverge from upstream.

**This is the development branch for GenieACS v1.3. It is unstable and not ready
for production use. For the latest stable release, see the
[v1.2 branch](https://github.com/genieacs/genieacs/tree/v1.2).**

GenieACS is a high performance Auto Configuration Server (ACS) for remote
management of TR-069 enabled devices. It utilizes a declarative and fault
tolerant configuration engine for automating complex provisioning scenarios at
scale. It's battle-tested to handle hundreds of thousands and potentially
millions of concurrent devices.

## Quick Start

Install [Node.js](http://nodejs.org/) and [MongoDB](http://www.mongodb.org/).
Refer to their corresponding documentation for installation instructions. The
supported versions are:

- Node.js: 12.3+
- MongoDB: 3.6+

Install GenieACS from NPM:

    sudo npm install -g genieacs

To build from source instead, clone this repo or download the source archive
then _cd_ into the source directory then run:

    npm install
    npm run build

Finally, run the following services (found under `./dist/bin/` if building from
source):

### genieacs-cwmp

This is the service that the CPEs will communicate with. It listens on port 7547
by default. Configure the ACS URL in your devices accordingly.

You may optionally use [genieacs-sim](https://github.com/genieacs/genieacs-sim)
as a dummy TR-069 simulator if you don't have a CPE at hand.

### genieacs-nbi

This is the northbound interface module. It exposes a REST API on port 7557 by
default. This one is only required if you have an external system integrating
with GenieACS using this API.

### genieacs-fs

This is the file server from which the CPEs will download firmware images and
such. It listens on port 7567 by default.

### genieacs-ui

This serves the web based user interface. It listens on port 3000 by default.
You must pass _--ui-jwt-secret_ argument to supply the secret key used for
signing browser cookies:

    genieacs-ui --ui-jwt-secret secret

The UI has plenty of configuration options. When you open GenieACS's UI in a
browser you'll be greeted with a database initialization wizard to help you
populate some initial configuration.

Visit [docs.genieacs.com](https://docs.genieacs.com) for more documentation and
a complete installation guide for production deployments.

## Source Development

The repository includes local development scripts for the four services. MongoDB
must be installed and running separately:

    npm install
    ./start-dev.sh

The first start creates `config/config.json` from `config/config.example.json`
and generates a private `UI_JWT_SECRET`. The local file is ignored by Git; edit
it for deployment-specific settings. The UI is available at
<http://localhost:3000>, with CWMP, NBI, and FS on ports 7547, 7557, and 7567.
Stop the services with:

    ./stop-dev.sh

The UI configuration and provisions are maintained as source files in
`config/ui/` and `config/provisions/`. Preview and apply them to the connected
GenieACS database with:

    node config/apply-config.mjs --dry-run
    node config/apply-config.mjs

Set `INFORM_USERNAME` and `INFORM_PASSWORD` in the local config before applying
the `inform` provision. A personal `config/provisions/inform.js` can be used as
a local override; that file is ignored by Git. The tracked
`config/provisions/inform.example.js` contains placeholders only. Set
`GRAFANA_DASHBOARD_URL` in `config/config.json` to add a deployment-specific
Grafana link to the device page; the shared YAML has no private address.

When UI authentication is enabled, set `UI_USER` and `UI_PASSWORD` for the
configuration script. Its defaults (`admin`/`admin`) are only for a fresh local
development setup. Set `UI_AUTH_ENABLED` to `false` only on an isolated, trusted
network; this grants full administrator access to every visitor.

KPI metric mappings live in `config/kpi.json`. KPI samples are recorded during
CWMP sessions and stored in MongoDB; the per-device and fleet charts use these
samples. `KPI_QUERY_INTERVAL_SECONDS` (default 300) controls the Periodic Inform
interval provisioned by `config/provisions/inform.js`. After changing it, run
`node config/apply-config.mjs`; devices adopt the interval on their next Inform.

The device page offers live CWMP traces. They are captured only while the Debug
panel is active and can be downloaded as a text file. Traces can include modem
configuration values, so use them only on trusted networks and stop capture when
finished. LDAP and KPI retention options are documented in
`docs/environment-variables.rst`.

## Support

The [forum](https://forum.genieacs.com) is a good place to get guidance and help
from the community. Head on over and join the conversation!

For commercial support options, please visit
[genieacs.com](https://genieacs.com/support/).

## License

Copyright 2013-2026 GenieACS Inc. GenieACS is released under the
[AGPLv3 license terms](https://raw.githubusercontent.com/genieacs/genieacs/master/LICENSE).
