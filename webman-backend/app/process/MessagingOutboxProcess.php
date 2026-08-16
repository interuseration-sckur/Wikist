<?php

namespace app\process;

use app\repository\MessagingRepository;
use app\service\CentrifugoPublisher;
use app\service\SensitiveDataRedactor;
use support\Log;
use Workerman\Timer;
use Workerman\Worker;

final class MessagingOutboxProcess
{
    private bool $running = false;
    private int $lastCleanupAt = 0;

    public function onWorkerStart(Worker $worker): void
    {
        (new MessagingRepository())->resetStaleOutbox();
        Timer::add(0.35, fn () => $this->drain());
    }

    private function drain(): void
    {
        if ($this->running) {
            return;
        }
        $this->running = true;
        try {
            $repository = new MessagingRepository();
            if ($this->lastCleanupAt < time() - 3600) {
                $repository->purgeOperationalResidue();
                $this->lastCleanupAt = time();
            }
            $publisher = new CentrifugoPublisher();
            foreach ($repository->claimOutbox(50) as $event) {
                try {
                    $payload = json_decode((string) $event->payload_json, true);
                    $publisher->publish(
                        (string) $event->channel,
                        is_array($payload) ? $payload : [],
                        (string) $event->event_id,
                    );
                    $repository->completeOutbox((int) $event->id);
                } catch (\Throwable $error) {
                    $repository->retryOutbox((int) $event->id, (int) $event->attempts, $error->getMessage());
                    Log::warning('Messaging outbox publish failed', SensitiveDataRedactor::context([
                        'eventId' => (string) $event->event_id,
                        'channel' => (string) $event->channel,
                        'attempts' => (int) $event->attempts,
                        'error' => $error->getMessage(),
                    ]));
                }
            }
        } catch (\Throwable $error) {
            Log::error('Messaging outbox drain failed', SensitiveDataRedactor::context(['error' => $error->getMessage()]));
        } finally {
            $this->running = false;
        }
    }
}
