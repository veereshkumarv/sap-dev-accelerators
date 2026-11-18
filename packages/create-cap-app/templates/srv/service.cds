{{!
What: Template for srv/<name>-service.cds - the OData service definition with role-based
    authorization.
Why: Every generated service is secure by default: authenticated access, @restrict grants for
    Viewer/Admin and an Admin-only action, which also drive the XSUAA role templates.
If missing or unlinked: create-cap-app stops with "template not found"; without it generated
    projects expose no service and xs-security.json has no roles.
}}
using { {{namespace}} as db } from '../db/schema';

@requires: 'authenticated-user'
service {{service}} @(path: '{{servicePath}}') {

  @restrict: [
    { grant: 'READ', to: 'Viewer' },
    { grant: '*', to: 'Admin' }
  ]
  entity {{entity}} as projection on db.{{entity}} actions {
    @(requires: 'Admin')
    action cancel() returns {{entity}};
  };

  @restrict: [
    { grant: 'READ', to: 'Viewer' },
    { grant: '*', to: 'Admin' }
  ]
  entity {{itemEntity}} as projection on db.{{itemEntity}};
}
