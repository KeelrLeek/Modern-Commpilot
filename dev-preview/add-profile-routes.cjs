// Seed active Profile folders, which do not have a clickable .leftnavfolder link.
const fs = require('node:fs');
const path = require('node:path');
const auditPath = path.join(__dirname, 'pjax-route-audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const profiles = {
  Reseller: [
    ['Service Providers','Reseller/ServiceProviders/index.jsp'],
    ['Enterprises','Reseller/ServiceProviders/index.jsp'],
    ['Groups','Reseller/Groups/'], ['Users','Reseller/Users/'],
    ['Service Instances','Reseller/ServiceInstances/'], ['Profile','Reseller/Profile/'],
    ['Administrators','Reseller/Admins/'],
    ['Activation Code Device Onboarding Policies','Reseller/DeviceActivationPolicy/'],
    ['Alternate User IDs','Reseller/AlternateUserIDs/'], ['STIR-SHAKEN','Reseller/StirShaken/']
  ],
  'Service Provider': [
    ['Groups','ServiceProvider/Members/'], ['Users','ServiceProvider/Users/'],
    ['Service Instances','ServiceProvider/ServiceInstances/'], ['Profile','ServiceProvider/Profile/'],
    ['Administrators','ServiceProvider/Admins/'], ['Schedules','ServiceProvider/Schedules/'],
    ['Activation Code Device Onboarding Policies','ServiceProvider/DeviceActivationPolicy/'],
    ['Alternate User IDs','ServiceProvider/AlternateUserIDs/'],
    ['Call Processing Policies','ServiceProvider/CallProcessingPolicy/'],
    ['Dial Plan Policy','ServiceProvider/DialPlanPolicy/'],
    ['Routing Profile','ServiceProvider/RoutingProfile/'],
    ['Dialable Caller ID','ServiceProvider/DialableCallerID/'],
    ['STIR-SHAKEN','ServiceProvider/StirShaken/']
  ],
  Group: [
    ['Users','Group/Members/'], ['Profile','Group/Profile/'], ['Administrators','Group/Admins/'],
    ['Announcement Repository','Group/AnnouncementRepository/Audio/'],
    ['Departments','Group/Departments/'], ['Schedules','Group/Schedules/'],
    ['Activation Code Device Onboarding Policies','Group/DeviceActivationPolicy/'],
    ['Alternate User IDs','Group/AlternateUserIDs/'],
    ['Call Processing Policies','Group/CallProcessingPolicy/'],
    ['Communication Barring Authorization Codes','Group/CommBarringAuthCodes/'],
    ['Dial Plan Policy','Group/DialPlanPolicy/'], ['Group Web Policies','Group/Policies/'],
    ['Routing Profile','Group/RoutingProfile/'],
    ['Virtual On-Net Enterprise Extensions','Group/VirtualOnNet/'],
    ['Dialable Caller ID','Group/DialableCallerID/'], ['STIR-SHAKEN','Group/StirShaken/']
  ],
  User: [
    ['Profile','User/Profile/'], ['Addresses','User/Addresses/'],
    ['Announcement Repository','User/AnnouncementRepository/Audio/'],
    ['Passwords','User/Password/'], ['Schedules','User/Schedules/'],
    ['Direct Route','User/DirectRoute/'], ['Route List','User/RouteList/'],
    ['Alternate User IDs','User/AlternateUserIDs/'], ['Assign Services','User/Services/'],
    ['Assign Call Centers','User/AssignCallCenters/'],
    ['Assign Route Point Supervisors','User/AgentSupervisors/'],
    ['Assign Xsi Policy Profile','User/AssignXsiPolicyProfile/'],
    ['Call Application Policies','User/OCICAppPolicies/'],
    ['Call Policies','User/CallPolicies/'],
    ['Call Processing Policies','User/CallProcessingPolicy/'],
    ['Communication Barring Authorization Codes','User/CommBarringAuthCodes/'],
    ['Device Policies','User/DevicePolicies/'], ['Privacy','User/Privacy/'],
    ['Office Zone','User/OfficeZone/']
  ],
  'Auto Attendant': [
    ['Profile','Group/Auto_Attendant/Modify/index.jsp'],
    ['Addresses','Group/Auto_Attendant/Addresses/index.jsp'],
    ['Announcement Repository','User/AnnouncementRepository/Audio/'],
    ['Password','User/Password/'], ['Submenus','Group/Auto_Attendant/Submenus/'],
    ['Voice Portal','User/VoicePortal/'], ['Assign Services','User/Services/'],
    ['Assign Xsi Policy Profile','User/AssignXsiPolicyProfile/'],
    ['Call Application Policies','User/OCICAppPolicies/'],
    ['Call Policies','User/CallPolicies/']
  ],
  'Hunt Group': [
    ['Profile','Group/Hunt_Group/Modify/index.jsp'],
    ['Addresses','Group/Hunt_Group/Addresses/index.jsp'],
    ['Announcement Repository','User/AnnouncementRepository/Audio/'],
    ['Password','User/Password/'], ['Voice Portal','User/VoicePortal/'],
    ['Assign Services','User/Services/'],
    ['Assign Xsi Policy Profile','User/AssignXsiPolicyProfile/'],
    ['Call Application Policies','User/OCICAppPolicies/'],
    ['Call Policies','User/CallPolicies/'],
    ['Privacy','User/PrivacyServiceInstance/'],
    ['Directory Number Hunting','User/DirectoryNumberHunting/']
  ],
  'Call Center': [
    ['Profile','Group/Call_Center/AddModify/index.jsp'],
    ['Addresses','Group/Call_Center/Addresses/index.jsp'],
    ['Agents','Group/Call_Center/Agents/'],
    ['Announcement Repository','User/AnnouncementRepository/Audio/'],
    ['Password','User/Password/'], ['Status & Statistics','User/CCStatistics/'],
    ['Supervisors','Group/Call_Center/Supervisors/'],
    ['Thresholds','Group/Call_Center/Thresholds/'],
    ['Announcements','User/Announcements/Entrance/'],
    ['Voice Portal','User/VoicePortal/'], ['Assign Services','User/Services/'],
    ['Assign Xsi Policy Profile','User/AssignXsiPolicyProfile/'],
    ['Call Application Policies','User/OCICAppPolicies/'],
    ['Call Policies','User/CallPolicies/'], ['Privacy','User/PrivacyServiceInstance/'],
    ['Directory Number Hunting','User/DirectoryNumberHunting/'],
    ['Distinctive Ringing','Group/Call_Center/RoutingPolicies/DistinctiveRinging/']
  ]
};
for (const [level, entries] of Object.entries(profiles)) {
  const area = `${level} / Profile`;
  for (const [label, suffix] of entries) {
    const routePath = `/commpilot/${suffix}`;
    const prior = audit.routes.find(route => route.label === label && route.path === routePath &&
      (route.area === level || route.area === area));
    if (prior) prior.area = area;
    else audit.routes.push({ id: `discovered-${audit.routes.length + 1}`, area, label,
      path: routePath, status: 'pending' });
  }
  if (!audit.inventory.folders.some(item => item.level === level && item.name === 'Profile')) {
    audit.inventory.folders.push({ level, name: 'Profile', count: entries.length });
  }
}
audit.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ routes: audit.routes.length, folders: audit.inventory.folders.length }));
