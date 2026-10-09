const now = Date.now();

// Clear cached data model to force a refresh
clear("Device", now);
clear("InternetGatewayDevice", now);

// Same walk the built-in "refresh" provision does, one wildcard level at a time up to MAX_DEPTH
let path = "Device";
for (let i = 0; i < 16; i++) {
  declare(path, { path: now, object: 1, writable: 1, value: now });
  path += ".*";
}
