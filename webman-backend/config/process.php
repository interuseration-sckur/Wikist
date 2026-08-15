<?php
/**
 * This file is part of webman.
 *
 * Licensed under The MIT License
 * For full copyright and license information, please see the MIT-LICENSE.txt
 * Redistributions of files must retain the above copyright notice.
 *
 * @author    walkor<walkor@workerman.net>
 * @copyright walkor<walkor@workerman.net>
 * @link      http://www.workerman.net/
 * @license   http://www.opensource.org/licenses/mit-license.php MIT License
 */

use support\Log;
use support\Request;
use app\process\Http;

global $argv;

$processes = [
    'webman' => [
        'handler' => Http::class,
        'listen' => 'http://' . (getenv('WEBMAN_HOST') ?: '0.0.0.0') . ':' . (getenv('WEBMAN_PORT') ?: '8898'),
        'count' => max(1, (int) (getenv('WEBMAN_WORKERS') ?: cpu_count())),
        'user' => getenv('WEBMAN_USER') ?: '',
        'group' => getenv('WEBMAN_GROUP') ?: '',
        'reusePort' => false,
        'eventLoop' => '',
        'context' => [],
        'constructor' => [
            'requestClass' => Request::class,
            'logger' => Log::channel('default'),
            'appPath' => app_path(),
            'publicPath' => public_path()
        ]
    ],
    // File update detection and automatic reload
    'monitor' => [
        'handler' => app\process\Monitor::class,
        'reloadable' => false,
        'constructor' => [
            // Monitor these directories
            'monitorDir' => array_merge([
                app_path(),
                config_path(),
                base_path() . '/process',
                base_path() . '/support',
                base_path() . '/resource',
                base_path() . '/.env',
            ], glob(base_path() . '/plugin/*/app'), glob(base_path() . '/plugin/*/config'), glob(base_path() . '/plugin/*/api')),
            // Files with these suffixes will be monitored
            'monitorExtensions' => [
                'php', 'html', 'htm', 'env'
            ],
            'options' => [
                'enable_file_monitor' => !in_array('-d', $argv) && DIRECTORY_SEPARATOR === '/',
                'enable_memory_monitor' => DIRECTORY_SEPARATOR === '/',
            ]
        ]
    ]
];

if (filter_var(getenv('LEGACY_REALTIME_ENABLED') ?: 'false', FILTER_VALIDATE_BOOL)) {
    $processes['wikist-legacy-realtime'] = [
        'handler' => app\process\RealtimeGateway::class,
        'listen' => 'websocket://' . (getenv('LEGACY_REALTIME_HOST') ?: '0.0.0.0') . ':' . (getenv('LEGACY_REALTIME_PORT') ?: '8897'),
        'count' => 1,
        'reloadable' => true,
    ];
}

if (filter_var(getenv('CENTRIFUGO_ENABLED') ?: 'false', FILTER_VALIDATE_BOOL)) {
    $processes['wikist-messaging-outbox'] = [
        'handler' => app\process\MessagingOutboxProcess::class,
        'count' => 1,
        'reloadable' => true,
    ];
}

return $processes;
