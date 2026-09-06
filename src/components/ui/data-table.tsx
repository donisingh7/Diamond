import type { ReactNode } from "react";

export type DataColumn<T> = { key: string; label: string; render: (record: T) => ReactNode };
/** One caller-owned record set, semantic table on desktop, labelled cards on mobile. */
export function DataTable<T>({ caption, columns, records, recordKey }: { caption: string; columns: DataColumn<T>[]; records: T[]; recordKey: (record: T) => string }) {
  return <div className="data-view"><div className="data-table-wrap"><table className="data-table"><caption>{caption}</caption><thead><tr>{columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{records.map(record => <tr key={recordKey(record)}>{columns.map((column, index) => index === 0 ? <th scope="row" key={column.key}>{column.render(record)}</th> : <td key={column.key}>{column.render(record)}</td>)}</tr>)}</tbody></table></div>
    <div className="data-cards" role="group" aria-label={caption}>{records.map(record => <dl key={recordKey(record)} className="data-record">{columns.map(column => <div key={column.key}><dt>{column.label}</dt><dd>{column.render(record)}</dd></div>)}</dl>)}</div>
  </div>;
}
