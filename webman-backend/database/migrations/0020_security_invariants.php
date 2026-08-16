<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TRIGGER IF NOT EXISTS trg_users_role_insert
BEFORE INSERT ON users
WHEN NEW.role NOT IN ('member', 'creator', 'editor', 'senior_editor', 'admin')
BEGIN
    SELECT RAISE(ABORT, 'invalid user role');
END;
CREATE TRIGGER IF NOT EXISTS trg_users_role_update
BEFORE UPDATE OF role ON users
WHEN NEW.role NOT IN ('member', 'creator', 'editor', 'senior_editor', 'admin')
BEGIN
    SELECT RAISE(ABORT, 'invalid user role');
END;
CREATE TRIGGER IF NOT EXISTS trg_users_status_insert
BEFORE INSERT ON users
WHEN NEW.status NOT IN ('active', 'disabled')
BEGIN
    SELECT RAISE(ABORT, 'invalid user status');
END;
CREATE TRIGGER IF NOT EXISTS trg_users_status_update
BEFORE UPDATE OF status ON users
WHEN NEW.status NOT IN ('active', 'disabled')
BEGIN
    SELECT RAISE(ABORT, 'invalid user status');
END;
CREATE TRIGGER IF NOT EXISTS trg_users_last_admin_update
BEFORE UPDATE OF role, status ON users
WHEN OLD.role = 'admin' AND OLD.status = 'active'
 AND (NEW.role <> 'admin' OR NEW.status <> 'active')
 AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active') <= 1
BEGIN
    SELECT RAISE(ABORT, 'cannot remove the last active administrator');
END;
CREATE TRIGGER IF NOT EXISTS trg_users_last_admin_delete
BEFORE DELETE ON users
WHEN OLD.role = 'admin' AND OLD.status = 'active'
 AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active') <= 1
BEGIN
    SELECT RAISE(ABORT, 'cannot delete the last active administrator');
END;
CREATE TRIGGER IF NOT EXISTS trg_org_member_role_insert
BEFORE INSERT ON organization_members
WHEN NEW.role NOT IN ('member', 'writer', 'translator', 'reviewer', 'coordinator', 'owner')
 OR NEW.status NOT IN ('active', 'pending', 'removed')
BEGIN
    SELECT RAISE(ABORT, 'invalid organization role');
END;
CREATE TRIGGER IF NOT EXISTS trg_org_member_role_update
BEFORE UPDATE OF role, status ON organization_members
WHEN NEW.role NOT IN ('member', 'writer', 'translator', 'reviewer', 'coordinator', 'owner')
 OR NEW.status NOT IN ('active', 'pending', 'removed')
BEGIN
    SELECT RAISE(ABORT, 'invalid organization membership');
END;
CREATE TRIGGER IF NOT EXISTS trg_org_last_owner_update
BEFORE UPDATE OF role, status ON organization_members
WHEN OLD.role = 'owner' AND OLD.status = 'active'
 AND (NEW.role <> 'owner' OR NEW.status <> 'active')
 AND EXISTS (SELECT 1 FROM writing_organizations WHERE id = OLD.organization_id AND status = 'active')
 AND (SELECT COUNT(*) FROM organization_members WHERE organization_id = OLD.organization_id AND role = 'owner' AND status = 'active') <= 1
BEGIN
    SELECT RAISE(ABORT, 'cannot remove the last active organization owner');
END;
CREATE TRIGGER IF NOT EXISTS trg_org_last_owner_delete
BEFORE DELETE ON organization_members
WHEN OLD.role = 'owner' AND OLD.status = 'active'
 AND EXISTS (SELECT 1 FROM writing_organizations WHERE id = OLD.organization_id AND status = 'active')
 AND (SELECT COUNT(*) FROM organization_members WHERE organization_id = OLD.organization_id AND role = 'owner' AND status = 'active') <= 1
BEGIN
    SELECT RAISE(ABORT, 'cannot delete the last active organization owner');
END;
CREATE INDEX IF NOT EXISTS idx_site_audit_logs_created ON site_audit_logs(created_at);
SQL);
        return;
    }

    foreach ([
        'trg_users_role_insert', 'trg_users_role_update', 'trg_users_status_insert', 'trg_users_status_update',
        'trg_users_last_admin_update', 'trg_users_last_admin_delete', 'trg_org_member_role_insert',
        'trg_org_member_role_update', 'trg_org_last_owner_update', 'trg_org_last_owner_delete',
    ] as $trigger) {
        $pdo->exec("DROP TRIGGER IF EXISTS {$trigger}");
    }
    try {
        $pdo->exec('CREATE INDEX idx_site_audit_logs_created ON site_audit_logs(created_at)');
    } catch (Throwable) {
        // The index may already exist on an installation upgraded more than once.
    }
    $pdo->exec("CREATE TRIGGER trg_users_role_insert BEFORE INSERT ON users FOR EACH ROW BEGIN IF NEW.role NOT IN ('member','creator','editor','senior_editor','admin') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invalid user role'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_users_role_update BEFORE UPDATE ON users FOR EACH ROW BEGIN IF NEW.role NOT IN ('member','creator','editor','senior_editor','admin') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invalid user role'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_users_status_insert BEFORE INSERT ON users FOR EACH ROW BEGIN IF NEW.status NOT IN ('active','disabled') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invalid user status'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_users_status_update BEFORE UPDATE ON users FOR EACH ROW BEGIN IF NEW.status NOT IN ('active','disabled') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invalid user status'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_users_last_admin_update BEFORE UPDATE ON users FOR EACH ROW BEGIN IF OLD.role = 'admin' AND OLD.status = 'active' AND (NEW.role <> 'admin' OR NEW.status <> 'active') AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active') <= 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot remove the last active administrator'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_users_last_admin_delete BEFORE DELETE ON users FOR EACH ROW BEGIN IF OLD.role = 'admin' AND OLD.status = 'active' AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active') <= 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot delete the last active administrator'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_org_member_role_insert BEFORE INSERT ON organization_members FOR EACH ROW BEGIN IF NEW.role NOT IN ('member','writer','translator','reviewer','coordinator','owner') OR NEW.status NOT IN ('active','pending','removed') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invalid organization membership'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_org_member_role_update BEFORE UPDATE ON organization_members FOR EACH ROW BEGIN IF NEW.role NOT IN ('member','writer','translator','reviewer','coordinator','owner') OR NEW.status NOT IN ('active','pending','removed') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invalid organization membership'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_org_last_owner_update BEFORE UPDATE ON organization_members FOR EACH ROW BEGIN IF OLD.role = 'owner' AND OLD.status = 'active' AND (NEW.role <> 'owner' OR NEW.status <> 'active') AND EXISTS (SELECT 1 FROM writing_organizations WHERE id = OLD.organization_id AND status = 'active') AND (SELECT COUNT(*) FROM organization_members WHERE organization_id = OLD.organization_id AND role = 'owner' AND status = 'active') <= 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot remove the last active organization owner'; END IF; END");
    $pdo->exec("CREATE TRIGGER trg_org_last_owner_delete BEFORE DELETE ON organization_members FOR EACH ROW BEGIN IF OLD.role = 'owner' AND OLD.status = 'active' AND EXISTS (SELECT 1 FROM writing_organizations WHERE id = OLD.organization_id AND status = 'active') AND (SELECT COUNT(*) FROM organization_members WHERE organization_id = OLD.organization_id AND role = 'owner' AND status = 'active') <= 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot delete the last active organization owner'; END IF; END");
};
