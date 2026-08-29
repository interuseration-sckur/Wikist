<?php

namespace app\repository;

use app\service\KnowledgeObjectId;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use support\Db;

final class KnowledgeGraphRepository
{
    private string $connection;

    public function __construct()
    {
        $this->connection = (string) config('wikist.passport.connection', 'wikist');
    }

    public function connection(): ConnectionInterface
    {
        return Db::connection($this->connection);
    }

    public function transaction(callable $callback): mixed
    {
        return $this->connection()->transaction($callback);
    }

    public function upsertObject(array $data): array
    {
        $type = KnowledgeObjectId::normalizeType((string) ($data['type'] ?? ''));
        $key = trim((string) ($data['key'] ?? ''));
        $source = trim((string) ($data['source'] ?? 'wikist')) ?: 'wikist';
        $globalId = (string) ($data['globalId'] ?? KnowledgeObjectId::make($type, $key, $source));
        $now = gmdate('c');
        $values = [
            'global_id' => $globalId,
            'object_type' => $type,
            'object_key' => $key,
            'source_system' => $source,
            'external_id' => (string) ($data['externalId'] ?? $key),
            'title' => mb_substr(trim((string) ($data['title'] ?? '')), 0, 500),
            'summary' => mb_substr(trim((string) ($data['summary'] ?? '')), 0, 4000),
            'canonical_url' => mb_substr(trim((string) ($data['url'] ?? '')), 0, 1000),
            'language' => mb_substr(trim((string) ($data['language'] ?? '')), 0, 32),
            'organization_id' => !empty($data['organizationId']) ? (int) $data['organizationId'] : null,
            'author_user_id' => !empty($data['authorUserId']) ? (int) $data['authorUserId'] : null,
            'status' => (string) ($data['status'] ?? 'active'),
            'search_text' => mb_substr(trim((string) ($data['searchText'] ?? implode(' ', [
                (string) ($data['title'] ?? ''),
                (string) ($data['summary'] ?? ''),
                $key,
            ]))), 0, 20000),
            'metadata_json' => $this->json($data['metadata'] ?? []),
            'synced_at' => (string) ($data['syncedAt'] ?? $now),
            'updated_at' => $now,
        ];
        $table = $this->connection()->table('knowledge_objects');
        $existing = $table->where('global_id', $globalId)->first();
        if ($existing) {
            $table->where('global_id', $globalId)->update($values);
        } else {
            $table->insert($values + ['created_at' => $now]);
        }
        return $this->objectData($this->connection()->table('knowledge_objects')->where('global_id', $globalId)->first());
    }

    public function find(string $globalId): ?array
    {
        $row = $this->connection()->table('knowledge_objects')->where('global_id', $globalId)->first();
        return $row ? $this->objectData($row) : null;
    }

    public function findBySource(string $source, string $type, string|int $key): ?array
    {
        $row = $this->connection()->table('knowledge_objects')
            ->where('source_system', $source)
            ->where('object_type', KnowledgeObjectId::normalizeType($type))
            ->where('object_key', (string) $key)
            ->first();
        return $row ? $this->objectData($row) : null;
    }

    public function relate(string $subjectGlobalId, string $predicate, string $objectGlobalId, array $data = []): array
    {
        $predicate = strtolower(trim($predicate));
        if (!preg_match('/^[a-z][a-z0-9_.-]{1,63}$/', $predicate)) {
            throw new \InvalidArgumentException('Invalid knowledge relation predicate.');
        }
        $relationKey = hash('sha256', implode('|', [$subjectGlobalId, $predicate, $objectGlobalId, (string) ($data['source'] ?? 'wikist')]));
        $now = gmdate('c');
        $values = [
            'relation_key' => $relationKey,
            'subject_global_id' => $subjectGlobalId,
            'predicate' => $predicate,
            'object_global_id' => $objectGlobalId,
            'actor_user_id' => !empty($data['actorUserId']) ? (int) $data['actorUserId'] : null,
            'source_system' => (string) ($data['source'] ?? 'wikist'),
            'metadata_json' => $this->json($data['metadata'] ?? []),
            'updated_at' => $now,
        ];
        $table = $this->connection()->table('knowledge_relations');
        if ($table->where('relation_key', $relationKey)->exists()) {
            $table->where('relation_key', $relationKey)->update($values);
        } else {
            $table->insert($values + ['created_at' => $now]);
        }
        return [
            'id' => $relationKey,
            'subject' => $subjectGlobalId,
            'predicate' => $predicate,
            'object' => $objectGlobalId,
        ];
    }

    public function relationExists(string $subjectGlobalId, string $predicate, string $objectGlobalId): bool
    {
        return $this->connection()->table('knowledge_relations')
            ->where('subject_global_id', $subjectGlobalId)
            ->where('predicate', strtolower(trim($predicate)))
            ->where('object_global_id', $objectGlobalId)
            ->exists();
    }

    /**
     * Collect references made by objects that already point at a parent object.
     * A question uses this to surface entries cited by its answers without
     * presenting every answer itself as a knowledge-relation card.
     */
    public function referencesFromIncomingSubjects(
        string $globalId,
        string $incomingPredicate,
        array $subjectTypes = ['answer'],
        array $referencePredicates = ['references'],
        int $limit = 24,
        ?array $allowedOrganizationIds = null,
    ): array {
        $limit = max(1, min(50, $limit));
        $subjectTypes = array_values(array_unique(array_map(
            static fn (string $type): string => KnowledgeObjectId::normalizeType($type),
            $subjectTypes,
        )));
        $referencePredicates = array_values(array_unique(array_map(
            static fn (string $predicate): string => strtolower(trim($predicate)),
            $referencePredicates,
        )));
        $query = $this->connection()->table('knowledge_relations as parent_relation')
            ->join('knowledge_objects as source_object', 'source_object.global_id', '=', 'parent_relation.subject_global_id')
            ->join('knowledge_relations as reference_relation', 'reference_relation.subject_global_id', '=', 'parent_relation.subject_global_id')
            ->join('knowledge_objects as target_object', 'target_object.global_id', '=', 'reference_relation.object_global_id')
            ->where('parent_relation.object_global_id', $globalId)
            ->where('parent_relation.predicate', strtolower(trim($incomingPredicate)))
            ->where('source_object.status', 'active')
            ->where('target_object.status', 'active');
        if ($subjectTypes !== []) {
            $query->whereIn('source_object.object_type', $subjectTypes);
        }
        if ($referencePredicates !== []) {
            $query->whereIn('reference_relation.predicate', $referencePredicates);
        }
        $this->applyOrganizationVisibility($query, $allowedOrganizationIds, 'source_object.organization_id');
        $this->applyOrganizationVisibility($query, $allowedOrganizationIds, 'target_object.organization_id');
        $rows = $query->select('reference_relation.*')
            ->orderByRaw("CASE target_object.object_type WHEN 'wiki_entry' THEN 0 WHEN 'revision' THEN 1 ELSE 2 END")
            ->orderByDesc('reference_relation.updated_at')
            ->limit(min(200, $limit * 4))
            ->get()->all();

        $items = [];
        $seen = [];
        foreach ($rows as $row) {
            $objectId = (string) $row->object_global_id;
            $key = (string) $row->predicate . '|' . $objectId;
            if (isset($seen[$key])) {
                continue;
            }
            $object = $this->find($objectId);
            if (!$object || !$this->objectOrganizationVisible($object, $allowedOrganizationIds)) {
                continue;
            }
            $seen[$key] = true;
            $items[] = [
                'direction' => 'outgoing',
                'predicate' => (string) $row->predicate,
                'object' => $object,
                'metadata' => $this->decode((string) $row->metadata_json),
                'updatedAt' => (string) $row->updated_at,
            ];
            if (count($items) >= $limit) {
                break;
            }
        }
        if ($items !== []) {
            return $items;
        }

        // Some deployed SQLite builds do not reliably optimize the three-way join above.
        // Fall back to the same relation traversal one answer at a time.
        $subjects = $this->incoming(
            $globalId,
            [strtolower(trim($incomingPredicate))],
            $subjectTypes,
            1,
            $limit,
            $allowedOrganizationIds,
        );
        foreach ($subjects['items'] as $subjectRelation) {
            $subjectId = (string) (($subjectRelation['object'] ?? [])['globalId'] ?? '');
            if ($subjectId === '') {
                continue;
            }
            $references = $this->related(
                $subjectId,
                $referencePredicates,
                1,
                $limit,
                $allowedOrganizationIds,
            );
            foreach ($references['items'] as $reference) {
                if (($reference['direction'] ?? '') !== 'outgoing') {
                    continue;
                }
                $object = $reference['object'] ?? [];
                $key = (string) ($reference['predicate'] ?? '') . '|' . (string) ($object['globalId'] ?? '');
                if ($key === '|' || isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $items[] = $reference;
                if (count($items) >= $limit) {
                    return $items;
                }
            }
        }
        return $items;
    }

    public function related(string $globalId, array $predicates = [], int $page = 1, int $limit = 12, ?array $allowedOrganizationIds = null): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('knowledge_relations as r')
            ->join('knowledge_objects as subject_object', 'subject_object.global_id', '=', 'r.subject_global_id')
            ->join('knowledge_objects as target_object', 'target_object.global_id', '=', 'r.object_global_id')
            ->where(function (Builder $directions) use ($globalId, $allowedOrganizationIds): void {
                $directions->where(function (Builder $outgoing) use ($globalId, $allowedOrganizationIds): void {
                    $outgoing->where('r.subject_global_id', $globalId)->where('target_object.status', 'active');
                    $this->applyOrganizationVisibility($outgoing, $allowedOrganizationIds, 'target_object.organization_id');
                })->orWhere(function (Builder $incoming) use ($globalId, $allowedOrganizationIds): void {
                    $incoming->where('r.object_global_id', $globalId)->where('subject_object.status', 'active');
                    $this->applyOrganizationVisibility($incoming, $allowedOrganizationIds, 'subject_object.organization_id');
                });
            });
        if ($predicates !== []) {
            $query->whereIn('r.predicate', array_values(array_unique(array_map('strval', $predicates))));
        }
        $total = (clone $query)->count('r.id');
        $rows = $query->select('r.*')->orderByDesc('r.updated_at')->orderByDesc('r.id')
            ->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        $items = [];
        foreach ($rows as $row) {
            $otherId = (string) $row->subject_global_id === $globalId
                ? (string) $row->object_global_id
                : (string) $row->subject_global_id;
            $object = $this->find($otherId);
            if (!$object || !$this->objectOrganizationVisible($object, $allowedOrganizationIds)) {
                continue;
            }
            $items[] = [
                'direction' => (string) $row->subject_global_id === $globalId ? 'outgoing' : 'incoming',
                'predicate' => (string) $row->predicate,
                'object' => $object,
                'metadata' => $this->decode((string) $row->metadata_json),
                'updatedAt' => (string) $row->updated_at,
            ];
        }
        return $this->page($items, $page, $limit, $total);
    }

    public function incoming(string $globalId, array $predicates = [], array $types = [], int $page = 1, int $limit = 12, ?array $allowedOrganizationIds = null): array
    {
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $query = $this->connection()->table('knowledge_relations as r')
            ->join('knowledge_objects as o', 'o.global_id', '=', 'r.subject_global_id')
            ->where('r.object_global_id', $globalId)
            ->where('o.status', 'active');
        if ($predicates !== []) {
            $query->whereIn('r.predicate', array_values(array_unique(array_map('strval', $predicates))));
        }
        if ($types !== []) {
            $query->whereIn('o.object_type', array_values(array_unique(array_map(
                static fn (string $type): string => KnowledgeObjectId::normalizeType($type),
                $types,
            ))));
        }
        $this->applyOrganizationVisibility($query, $allowedOrganizationIds, 'o.organization_id');
        $total = (clone $query)->distinct()->count('r.subject_global_id');
        $ids = (clone $query)->select('r.subject_global_id')
            ->distinct()->orderByDesc('r.subject_global_id')
            ->offset(($page - 1) * $limit)->limit($limit)
            ->pluck('r.subject_global_id')->map('strval')->all();
        if ($ids === []) {
            return $this->page([], $page, $limit, $total);
        }
        $objects = [];
        foreach ($this->connection()->table('knowledge_objects')->whereIn('global_id', $ids)->get()->all() as $row) {
            $objects[(string) $row->global_id] = $this->objectData($row);
        }
        $relations = [];
        foreach ($this->connection()->table('knowledge_relations')
            ->where('object_global_id', $globalId)->whereIn('subject_global_id', $ids)
            ->orderByDesc('updated_at')->get()->all() as $row) {
            $relations[(string) $row->subject_global_id] ??= $row;
        }
        $items = [];
        foreach ($ids as $id) {
            if (!isset($objects[$id], $relations[$id])) {
                continue;
            }
            $row = $relations[$id];
            $items[] = [
                'direction' => 'incoming',
                'predicate' => (string) $row->predicate,
                'object' => $objects[$id],
                'metadata' => $this->decode((string) $row->metadata_json),
                'updatedAt' => (string) $row->updated_at,
            ];
        }
        return $this->page($items, $page, $limit, $total);
    }

    public function search(string $query, array $types = [], int $page = 1, int $limit = 12, ?array $allowedOrganizationIds = null): array
    {
        $query = mb_strtolower(trim($query));
        $page = max(1, $page);
        $limit = max(1, min(50, $limit));
        $builder = $this->connection()->table('knowledge_objects')->where('status', 'active');
        if ($types !== []) {
            $builder->whereIn('object_type', array_values(array_unique(array_map(
                static fn (string $type): string => KnowledgeObjectId::normalizeType($type),
                $types,
            ))));
        }
        if ($query !== '') {
            $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $query) . '%';
            $builder->where(function (Builder $nested) use ($like): void {
                $nested->whereRaw("LOWER(title) LIKE ? ESCAPE '!'", [$like])
                    ->orWhereRaw("LOWER(search_text) LIKE ? ESCAPE '!'", [$like]);
            });
        }
        $this->applyOrganizationVisibility($builder, $allowedOrganizationIds, 'organization_id');
        $total = (clone $builder)->count();
        $rows = $builder->orderByDesc('updated_at')->offset(($page - 1) * $limit)->limit($limit)->get()->all();
        return $this->page(array_map(fn (object $row): array => $this->objectData($row), $rows), $page, $limit, $total);
    }

    private function objectData(object $row): array
    {
        return [
            'globalId' => (string) $row->global_id,
            'type' => (string) $row->object_type,
            'key' => (string) $row->object_key,
            'source' => (string) $row->source_system,
            'externalId' => (string) $row->external_id,
            'title' => (string) $row->title,
            'summary' => (string) $row->summary,
            'url' => (string) $row->canonical_url,
            'language' => (string) $row->language,
            'organizationId' => $row->organization_id !== null ? (int) $row->organization_id : null,
            'authorUserId' => $row->author_user_id !== null ? (int) $row->author_user_id : null,
            'status' => (string) $row->status,
            'metadata' => $this->decode((string) $row->metadata_json),
            'syncedAt' => (string) $row->synced_at,
            'updatedAt' => (string) $row->updated_at,
        ];
    }

    private function applyOrganizationVisibility(Builder $builder, ?array $allowedOrganizationIds, string $column): void
    {
        if ($allowedOrganizationIds === null) {
            return;
        }
        $allowedOrganizationIds = array_values(array_unique(array_filter(array_map('intval', $allowedOrganizationIds), static fn (int $id): bool => $id > 0)));
        $builder->where(function (Builder $scope) use ($allowedOrganizationIds, $column): void {
            $scope->whereNull($column)
                ->orWhereIn($column, function (Builder $organizations): void {
                    $organizations->select('id')->from('writing_organizations')
                        ->where('status', 'active')->where('visibility', 'public');
                });
            if ($allowedOrganizationIds !== []) {
                $scope->orWhereIn($column, $allowedOrganizationIds);
            }
        });
    }

    private function objectOrganizationVisible(array $object, ?array $allowedOrganizationIds): bool
    {
        if ($allowedOrganizationIds === null || empty($object['organizationId'])) {
            return true;
        }
        $organizationId = (int) $object['organizationId'];
        if (in_array($organizationId, array_map('intval', $allowedOrganizationIds), true)) {
            return true;
        }
        return $this->connection()->table('writing_organizations')
            ->where('id', $organizationId)->where('status', 'active')->where('visibility', 'public')->exists();
    }

    private function page(array $items, int $page, int $limit, int $total): array
    {
        return [
            'items' => $items,
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'pages' => max(1, (int) ceil($total / $limit)),
        ];
    }

    private function json(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function decode(string $value): array
    {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
}
