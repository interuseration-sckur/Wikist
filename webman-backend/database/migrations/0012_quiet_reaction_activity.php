<?php

return static function (PDO $pdo, string $driver): void {
    $statement = $pdo->prepare(
        "UPDATE community_activity SET canceled_at = ? WHERE canceled_at = '' AND event_type LIKE '%.reaction.%'"
    );
    $statement->execute([gmdate('c')]);
};
