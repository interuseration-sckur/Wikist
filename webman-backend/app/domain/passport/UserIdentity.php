<?php

namespace app\domain\passport;

final readonly class UserIdentity
{
    public function __construct(
        public int $id,
        public string $username,
        public string $email,
        public string $displayName,
        public string $role,
        public string $status,
        public string $bio = '',
        public string $avatarUrl = '',
        public array $socialLinks = [],
        public string $pageMd = '',
        public string $createdAt = '',
        public string $updatedAt = '',
        public string $emailVerifiedAt = '',
        public bool $twoFactorEnabled = false,
        public string $source = 'wikist',
    ) {
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function toArray(bool $public = false): array
    {
        $capabilities = RolePolicy::capabilities($this->role);
        $data = [
            'id' => $this->id,
            'username' => $this->username,
            'email' => $this->email,
            'displayName' => $this->displayName,
            'role' => $this->role,
            'group' => $this->role,
            'groupLabel' => RolePolicy::label($this->role),
            'status' => $this->status,
            'bio' => $this->bio,
            'avatarUrl' => $this->avatarUrl,
            'socialLinks' => $this->socialLinks,
            'pageMd' => $this->pageMd,
            'createdAt' => $this->createdAt,
            'updatedAt' => $this->updatedAt,
            'emailVerifiedAt' => $this->emailVerifiedAt,
            'emailVerified' => $this->emailVerifiedAt !== '',
            'twoFactorEnabled' => $this->twoFactorEnabled,
            'capabilities' => $capabilities,
        ];
        if ($public) {
            unset($data['email'], $data['emailVerifiedAt'], $data['twoFactorEnabled']);
            $data['isBanned'] = !$this->isActive();
        }
        return $data;
    }
}
