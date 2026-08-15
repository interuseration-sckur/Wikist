<?php

namespace app\domain\passport;

final class RolePolicy
{
    private const ROLES = ['member', 'creator', 'editor', 'senior_editor', 'admin'];
    private const LABELS = [
        'member' => '普通用户',
        'creator' => '创作者',
        'editor' => '编辑',
        'senior_editor' => '资深编辑',
        'admin' => '管理员',
    ];

    public static function normalize(?string $role): string
    {
        $role = strtolower(trim((string) $role));
        $role = match ($role) {
            'senior', 'senior-editor' => 'senior_editor',
            default => $role,
        };
        return in_array($role, self::ROLES, true) ? $role : 'member';
    }

    public static function isValid(?string $role): bool
    {
        $role = strtolower(trim((string) $role));
        $role = match ($role) {
            'senior', 'senior-editor' => 'senior_editor',
            default => $role,
        };
        return in_array($role, self::ROLES, true);
    }

    public static function all(): array
    {
        return self::ROLES;
    }

    public static function allows(string $actual, string $minimum): bool
    {
        return array_search(self::normalize($actual), self::ROLES, true)
            >= array_search(self::normalize($minimum), self::ROLES, true);
    }

    public static function label(string $role): string
    {
        $role = self::normalize($role);
        return self::LABELS[$role];
    }

    public static function capabilities(string $role): array
    {
        return [
            'admin' => self::allows($role, 'admin'),
            'staff' => self::allows($role, 'senior_editor'),
            'manageUsers' => self::allows($role, 'admin'),
            'manageContent' => self::allows($role, 'senior_editor'),
            'reviewContent' => self::allows($role, 'senior_editor'),
            'managePermissions' => self::allows($role, 'senior_editor'),
            'deletePages' => self::allows($role, 'senior_editor'),
        ];
    }
}
