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

namespace app\middleware;

use Webman\MiddlewareInterface;
use Webman\Http\Response;
use Webman\Http\Request;

/**
 * Class StaticFile
 * @package app\middleware
 */
class StaticFile implements MiddlewareInterface
{
    public function process(Request $request, callable $handler): Response
    {
        // Access to dotfiles is prohibited.
        if (strpos($request->path(), '/.') !== false) {
            return response('<h1>403 forbidden</h1>', 403);
        }
        /** @var Response $response */
        $response = $handler($request);
        $path = $request->path();
        $headers = ['X-Content-Type-Options' => 'nosniff'];

        if ($path === '/' || $path === '/index.html') {
            $headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            $headers['Pragma'] = 'no-cache';
            $headers['Expires'] = '0';
        } elseif (str_starts_with($path, '/assets/')) {
            $version = trim((string) $request->get('v', ''));
            $headers['Cache-Control'] = $version !== ''
                ? 'public, max-age=31536000, immutable'
                : 'no-cache, must-revalidate';
        }

        return $response->withHeaders($headers);
    }
}
