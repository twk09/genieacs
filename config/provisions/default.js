const now = Date.now();

// Refresh the whole data model daily
const daily = Date.now(86400000);

declare("Device.*", { value: daily });

// Wi-Fi
declare("Device.WiFi.SSID.*.SSID", { value: now });
declare("Device.WiFi.SSID.*.BSSID", { value: now });
declare("Device.WiFi.Radio.*.Alias", { value: now });
declare("Device.WiFi.Radio.*.Status", { value: now });
declare("Device.WiFi.Radio.*.Channel", { value: now });
declare("Device.WiFi.Radio.*.CurrentOperatingChannelBandwidth", { value: now });
declare("Device.WiFi.Radio.*.OperatingFrequencyBand", { value: now });
declare("Device.WiFi.Radio.*.TransmitPower", { value: now });
declare("Device.WiFi.Radio.*.RegulatoryRegionSubRegion", { value: now });
declare("Device.WiFi.AccessPoint.*.AssociatedDeviceNumberOfEntries", {
  value: now,
});
declare("Device.WiFi.AccessPoint.*.Security.KeyPassphrase", { value: now });
declare("Device.WiFi.AccessPoint.*.AssociatedDevice.*.*", { value: now });

// Network and LAN hosts
declare("Device.IP.Interface.*.IPv4Address.*.IPAddress", { value: now });
declare("Device.Hosts.Host.*.HostName", { value: now });
declare("Device.Hosts.Host.*.IPAddress", { value: now });
declare("Device.Hosts.Host.*.PhysAddress", { value: now });
declare("Device.IP.Interface.2.Stats.BytesSent", { value: now });
declare("Device.IP.Interface.2.Stats.BytesReceived", { value: now });
declare("Device.DHCPv4.Server.Pool.1.Client.*.Chaddr", { value: now });
declare("Device.DHCPv4.Server.Pool.1.Client.*.IPv4Address", { value: now });
declare("Device.DHCPv4.Server.Pool.1.Client.*.Alias", { value: now });
declare("Device.DHCPv4.Server.Pool.1.Client.*.IPv4Address.1.IPAddress", {
  value: now,
});
declare(
  "Device.DHCPv4.Server.Pool.1.Client.*.IPv4Address.1.LeaseTimeRemaining",
  { value: now },
);

// Device status
declare("Device.DeviceInfo.*", { value: now });
declare("Device.DeviceInfo.UpTime", { value: now });
declare("Device.DeviceInfo.MemoryStatus.*", { value: now });
declare("Device.DeviceInfo.ProcessStatus.CPUUsage", { value: now });
declare("Device.DeviceInfo.TemperatureStatus.*.*", { value: now });

// Voice and vendor services
declare("Device.Services.*.*", { value: now });
declare("Device.Services.VoiceService.*.SIP.*", { value: now });
declare("Device.Services.VoiceService.*.SIP.Client.*", { value: now });
declare("Device.Services.VoiceService.*.SIP.Network.*", { value: now });
declare("Device.Services.X_Dzsi.*", { value: now });
declare("Device.Services.X_Dzsi.CloudCheck.*", { value: now });
