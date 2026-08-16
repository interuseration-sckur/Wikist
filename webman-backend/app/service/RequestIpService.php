<?php

namespace app\service;

use Webman\Http\Request;

final class RequestIpService
{
    public function clientIp(Request $request): string
    {
        $remote = $request->getRemoteIp();
        if (!$this->isTrustedProxy($remote)) {
            return $remote;
        }
        $forwarded = array_values(array_filter(array_map('trim', explode(',', (string) $request->header('x-forwarded-for')))));
        if ($forwarded === []) {
            $candidate = trim((string) ($request->header('x-real-ip') ?: ''));
            return filter_var($candidate, FILTER_VALIDATE_IP) ? $candidate : $remote;
        }
        $chain = [...$forwarded, $remote];
        for ($index = count($chain) - 1; $index >= 0; $index--) {
            $candidate = $chain[$index];
            if (filter_var($candidate, FILTER_VALIDATE_IP) && !$this->isTrustedProxy($candidate)) {
                return $candidate;
            }
        }
        $candidate = $forwarded[0] ?? $remote;
        return filter_var($candidate, FILTER_VALIDATE_IP) ? $candidate : $remote;
    }

    public function isTrustedProxy(string $address): bool
    {
        if (!filter_var($address, FILTER_VALIDATE_IP)) {
            return false;
        }
        foreach ((array) config('wikist.security.trusted_proxies', ['127.0.0.1/32', '::1/128']) as $range) {
            if ($this->contains((string) $range, $address)) {
                return true;
            }
        }
        return false;
    }

    private function contains(string $range, string $address): bool
    {
        [$network, $prefix] = array_pad(explode('/', trim($range), 2), 2, null);
        $networkBytes = @inet_pton($network);
        $addressBytes = @inet_pton($address);
        if ($networkBytes === false || $addressBytes === false || strlen($networkBytes) !== strlen($addressBytes)) {
            return false;
        }
        $bits = strlen($networkBytes) * 8;
        $prefix = $prefix === null ? $bits : (int) $prefix;
        if ($prefix < 0 || $prefix > $bits) {
            return false;
        }
        $whole = intdiv($prefix, 8);
        $remainder = $prefix % 8;
        if ($whole > 0 && substr($networkBytes, 0, $whole) !== substr($addressBytes, 0, $whole)) {
            return false;
        }
        if ($remainder === 0) {
            return true;
        }
        $mask = (0xff << (8 - $remainder)) & 0xff;
        return (ord($networkBytes[$whole]) & $mask) === (ord($addressBytes[$whole]) & $mask);
    }
}
