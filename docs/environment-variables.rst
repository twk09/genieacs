.. _environment-variables:

Environment Variables
=====================

Configuring GenieACS services can be done through the following environment
variables:

.. attention::

  All GenieACS environment variables must be prefixed with ``GENIEACS_``.

MONGODB_CONNECTION_URL
  MongoDB connection string.

  Default: ``mongodb://127.0.0.1/genieacs``

EXT_DIR
  The directory from which to look up extension scripts.

  Default: ``<installation dir>/config/ext``

EXT_TIMEOUT
  Timeout (in milliseconds) to allow for calls to extensions to return a
  response.

  Default: ``3000``

SCRIPT_TIMEOUT
  Timeout (in milliseconds) for executing provision and virtual parameter
  scripts. Values below 50 are clamped to 50.

  Default: ``100``

DEBUG_FILE
  File to dump CPE debug log.

  Default: unset

DEBUG_FORMAT
  Debug log format. Valid values are 'yaml' and 'json'.

  Default: ``yaml``

DEBUG_TRACE_TTL
  How long, in seconds, the messages captured by the live debug trace in
  genieacs-ui are kept on the server. They are deleted immediately when the
  trace is stopped, so this only matters when the browser is closed without
  stopping it.

  Default: ``120``

DEBUG_TRACE_MAX_BODY
  Maximum number of characters of a message body stored in a debug trace. Longer
  bodies are truncated.

  Default: ``524288``

KPI_CONFIG_FILE
  JSON file containing the metric names, device parameter paths, units, and
  counter/gauge types used by the per-device KPI chart.

  Default: ``config/kpi.json``

KPI_RAW_TTL
  Retention in seconds for raw five-minute KPI samples.

  Default: ``7776000``

KPI_HOURLY_TTL
  Retention in seconds for hourly KPI aggregates.

  Default: ``34128000``

KPI_QUERY_INTERVAL_SECONDS
  Periodic Inform interval provisioned to CPEs by ``config/provisions/inform.js``.
  KPI samples are recorded from CWMP sessions at this cadence. After changing
  ``config/config.json``, run ``node config/apply-config.mjs``; each CPE applies
  the new interval on its next Inform. This does not create a separate polling
  connection request.

  Default: ``300``

LOG_FORMAT
  The format used for the log entries in ``CWMP_LOG_FILE``, ``NBI_LOG_FILE``,
  ``FS_LOG_FILE``, and ``UI_LOG_FILE``. Possible values are ``simple`` and
  ``json``.

  Default: ``simple``

ACCESS_LOG_FORMAT
  The format used for the log entries in ``CWMP_ACCESS_LOG_FILE``,
  ``NBI_ACCESS_LOG_FILE``, ``FS_ACCESS_LOG_FILE``, and ``UI_ACCESS_LOG_FILE``.
  Possible values are ``simple`` and ``json``.

  Default: ``simple``

CWMP_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-cwmp. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

CWMP_PORT
  The TCP port that genieacs-cwmp listens on.

  Default: ``7547``

CWMP_INTERFACE
  The network interface that genieacs-cwmp binds to.

  Default: ``::``

CWMP_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

CWMP_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

CWMP_LOG_FILE
  File to log process related events for genieacs-cwmp. If omitted, logs will
  go to stderr.

  Default: unset

CWMP_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-cwmp. If omitted, logs will go to
  stdout.

  Default: unset

NBI_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-nbi. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

NBI_PORT
  The TCP port that genieacs-nbi listens on.

  Default: ``7557``

NBI_INTERFACE
  The network interface that genieacs-nbi binds to.

  Default: ``::``

NBI_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

NBI_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

NBI_LOG_FILE
  File to log process related events for genieacs-nbi. If omitted, logs will go
  to stderr.

  Default: unset

NBI_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-nbi. If omitted, logs will go to
  stdout.

  Default: unset

FS_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-fs. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

FS_PORT
  The TCP port that genieacs-fs listens on.

  Default: ``7567``

FS_INTERFACE
  The network interface that genieacs-fs binds to.

  Default: ``::``

FS_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

FS_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

FS_LOG_FILE
  File to log process related events for genieacs-fs. If omitted, logs will go
  to stderr.

  Default: unset

FS_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-fs. If omitted, logs will go to
  stdout.

  Default: unset

FS_URL_PREFIX
  The URL prefix (e.g. 'https://example.com:7567/') to use when generating the
  file URL for TR-069 Download requests. Set this if genieacs-fs and
  genieacs-cwmp are behind a proxy or running on different servers.

  Default: auto generated based on the hostname from the ACS URL, FS_PORT
  config, and whether or not SSL is enabled for genieacs-fs.

UI_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-ui. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

UI_PORT
  The TCP port that genieacs-ui listens on.

  Default: ``3000``

UI_INTERFACE
  The network interface that genieacs-ui binds to.

  Default: ``::``

UI_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

UI_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

UI_LOG_FILE
  File to log process related events for genieacs-ui. If omitted, logs will go
  to stderr.

  Default: unset

UI_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-ui. If omitted, logs will go to
  stdout.

  Default: unset

UI_JWT_SECRET
  The key used for signing JWT tokens that are stored in browser cookies. The
  string can be up to 64 characters in length.

  Default: unset

UI_AUTH_ENABLED
  Set to ``false`` to disable authentication in genieacs-ui. Every visitor is
  then treated as an administrator with full access, so only use this on
  networks you trust.

  Default: ``true``

LDAP_ENABLED
  Allow users to log in to genieacs-ui with their LDAP credentials. Local users
  are checked first. A user must end up with at least one role, otherwise the
  login is rejected.

  Default: ``false``

LDAP_URL
  URL of the LDAP server, e.g. ``ldaps://ldap.example.com:636``.

  Default: unset

LDAP_START_TLS
  Upgrade a plain ``ldap://`` connection using StartTLS.

  Default: ``false``

LDAP_TLS_REJECT_UNAUTHORIZED
  Reject LDAP servers whose TLS certificate cannot be verified.

  Default: ``true``

LDAP_TIMEOUT
  Connection and operation timeout in milliseconds.

  Default: ``5000``

LDAP_BIND_DN
  DN of the account used to look up users. If omitted, the search is done
  anonymously.

  Default: unset

LDAP_BIND_PASSWORD
  Password of the account in ``LDAP_BIND_DN``.

  Default: unset

LDAP_USER_BASE_DN
  Base DN under which users are searched.

  Default: unset

LDAP_USER_FILTER
  Search filter used to find the user. ``{username}`` is replaced with the
  escaped login name. The filter must match exactly one entry.

  Default: ``(uid={username})``

LDAP_GROUP_ATTRIBUTE
  Attribute of the user entry that lists the groups the user belongs to.

  Default: ``memberOf``

LDAP_ROLE_MAP
  Maps group DNs to genieacs-ui roles. Entries are separated by ``;`` and each
  one has the form ``<group DN>=><role>[,<role>...]``.

  Default: unset

LDAP_DEFAULT_ROLES
  Comma-separated roles granted to every user that authenticates through LDAP.

  Default: unset
