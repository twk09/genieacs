const username = __INFORM_USERNAME__;
const password = __INFORM_PASSWORD__;

const informInterval = 300;
const daily = Date.now(86400000);
const informTime = daily % 86400000;

// Set the ACS URL only after verifying the address and port for this deployment.
// declare("Device.ManagementServer.URL", { value: daily }, { value: "http://<acs-host>:7547" });

declare(
  "Device.ManagementServer.Username",
  { value: daily },
  { value: username },
);
declare(
  "Device.ManagementServer.Password",
  { value: daily },
  { value: password },
);
declare(
  "Device.ManagementServer.ConnectionRequestUsername",
  { value: daily },
  { value: username },
);
declare(
  "Device.ManagementServer.ConnectionRequestPassword",
  { value: daily },
  { value: password },
);
declare(
  "Device.ManagementServer.PeriodicInformEnable",
  { value: daily },
  { value: true },
);
declare(
  "Device.ManagementServer.PeriodicInformInterval",
  { value: daily },
  { value: informInterval },
);
declare(
  "Device.ManagementServer.PeriodicInformTime",
  { value: daily },
  { value: informTime },
);
