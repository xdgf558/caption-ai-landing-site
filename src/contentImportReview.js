const terminalContentImportStatuses = ['completed', 'completed_with_warnings', 'reviewed'];

export const contentImportSourceKinds = (importType) =>
  importType === 'signal_brief' ? ['signal_brief', 'signal_automation'] : [importType];

export const buildContentImportListQuery = ({
  importId = 0,
  importType,
  limit,
  review = 'all'
}) => {
  const clauses = ['content_imports.import_type = ?'];
  const params = [importType];

  if (importId) {
    clauses.push('content_imports.id = ?');
    params.push(importId);
  }

  if (review === 'pending') {
    const sourceKinds = contentImportSourceKinds(importType);
    const sourceKindPlaceholders = sourceKinds.map(() => '?').join(', ');
    const terminalStatusPlaceholders = terminalContentImportStatuses.map(() => '?').join(', ');
    clauses.push(
      `(content_imports.status NOT IN (${terminalStatusPlaceholders}) OR EXISTS (
         SELECT 1
         FROM content_entries pending_entry
         WHERE pending_entry.source_kind IN (${sourceKindPlaceholders})
           AND pending_entry.source_ref = content_imports.filename
           AND pending_entry.status IN ('draft', 'scheduled')
       ))`
    );
    params.push(...terminalContentImportStatuses, ...sourceKinds);
  }

  return {
    params: [...params, limit],
    sql: `SELECT content_imports.*
          FROM content_imports
          WHERE ${clauses.join(' AND ')}
          ORDER BY content_imports.updated_at DESC, content_imports.id DESC
          LIMIT ?`
  };
};
