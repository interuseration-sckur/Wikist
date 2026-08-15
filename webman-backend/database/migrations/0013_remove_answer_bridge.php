<?php

return static function (PDO $pdo, string $driver): void {
    foreach ([
        'answer_bridge_nonces',
        'answer_sync_cursors',
        'answer_api_cache',
        'answer_event_inbox',
        'answer_identity_links',
        'community_legacy_map',
    ] as $table) {
        $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    }
};
