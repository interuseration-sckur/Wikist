<?php

namespace app\process;

use app\service\RealtimeTicketService;
use Workerman\Connection\TcpConnection;
use Workerman\Protocols\Http\Request;
use Workerman\Worker;

final class RealtimeGateway
{
    public function onWorkerStart(Worker $worker): void
    {
    }

    public function onWebSocketConnect(TcpConnection $connection, Request $request): void
    {
        try {
            $claims = (new RealtimeTicketService())->verify((string) $request->get('ticket'));
            $connection->wikistUser = [
                'id' => (int) $claims->sub,
                'username' => (string) $claims->username,
                'role' => (string) $claims->role,
            ];
            $connection->wikistChannels = ['user:' . $claims->sub => true];
            $connection->send(json_encode([
                'type' => 'realtime.ready',
                'user' => $connection->wikistUser,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } catch (\Throwable) {
            $connection->close(json_encode(['type' => 'error', 'code' => 'invalid_ticket']));
        }
    }

    public function onMessage(TcpConnection $connection, string $data): void
    {
        if (!isset($connection->wikistUser)) {
            $connection->close();
            return;
        }
        $message = json_decode($data, true);
        if (!is_array($message)) {
            $connection->send(json_encode(['type' => 'error', 'code' => 'invalid_message']));
            return;
        }
        if (($message['type'] ?? '') === 'ping') {
            $connection->send(json_encode(['type' => 'pong', 'at' => gmdate('c')]));
            return;
        }
        $connection->send(json_encode(['type' => 'ack', 'id' => $message['id'] ?? null], JSON_UNESCAPED_UNICODE));
    }
}
