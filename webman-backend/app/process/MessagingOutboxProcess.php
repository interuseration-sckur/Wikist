<?php

namespace app\process;

use app\repository\MessagingRepository;
use app\service\CentrifugoPublisher;
use support\Log;
use Workerman\Timer;
use Workerman\Worker;

final class MessagingOutboxProcess
{
    private bool $running = false;

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
                    Log::warning('Messaging outbox publish failed', [
                        'eventId' => (string) $event->event_id,
                        'channel' => (string) $event->channel,
                        'attempts' => (int) $event->attempts,
                        'error' => $error->getMessage(),
                    ]);
                }
            }
        } catch (\Throwable $error) {
            Log::error('Messaging outbox drain failed', ['error' => $error->getMessage()]);
        } finally {
            $this->running = false;
        }
    }
}
