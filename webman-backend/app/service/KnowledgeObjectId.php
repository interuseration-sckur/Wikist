<?php

namespace app\service;

use app\exception\ApiException;

final class KnowledgeObjectId
{
    public const TYPES = [
        'wiki_entry',
        'page',
        'question',
        'answer',
        'comment',
        'revision',
        'organization',
        'user',
        'chat_message',
        'selection',
    ];

    public static function make(string $type, string|int $key, string $source = 'wikist'): string
    {
        $type = self::normalizeType($type);
        $source = preg_replace('/[^a-z0-9_-]+/i', '-', strtolower(trim($source))) ?: 'wikist';
        $key = trim((string) $key);
        if ($key === '' || mb_strlen($key) > 500) {
            throw new ApiException('知识对象标识无效。', 422, 'invalid_knowledge_object_key');
        }
        return sprintf('wko:v1:%s:%s:%s', $source, $type, hash('sha256', $key));
    }

    public static function normalizeType(string $type): string
    {
        $type = strtolower(trim($type));
        if ($type === 'page') {
            $type = 'wiki_entry';
        }
        if (!in_array($type, self::TYPES, true)) {
            throw new ApiException('不支持的知识对象类型。', 422, 'invalid_knowledge_object_type');
        }
        return $type;
    }
}
