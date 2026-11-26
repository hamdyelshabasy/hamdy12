import React, { useEffect, useState } from 'react';
import { BookCheck } from 'lucide-react';
import { apiRequest, formatDateTimeAr } from '../../lib/api.ts';

interface StudentHomeworkSummaryItem {
  assignmentId: number;
  titleAr: string;
  version: number;
  status: string;
  statusLabelAr: string;
  isLate: boolean;
  awardedGrade: number | null;
  maximumGrade: number;
  isGradePublished: boolean;
  submittedAt: string | null;
  gradedAt: string | null;
}

export const StudentHomeworkSummaryBlock: React.FC<{ studentId: number }> = ({ studentId }) => {
  const [items, setItems] = useState<StudentHomeworkSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<{ items: StudentHomeworkSummaryItem[] }>(`/api/admin/homework/student-summary/${studentId}`)
      .then((res) => {
        if (active) setItems(res.items || []);
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [studentId]);

  const gradedItems = items.filter((i) => i.awardedGrade !== null && i.isGradePublished);
  const avgPct =
    gradedItems.length > 0
      ? Math.round(
          gradedItems.reduce(
            (acc, i) => acc + ((i.awardedGrade || 0) / Math.max(1, i.maximumGrade)) * 100,
            0,
          ) / gradedItems.length,
        )
      : 0;

  return (
    <div className="space-y-3 border-t border-slate-200 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookCheck className="h-4 w-4 text-[#2563EB]" />
          <h4 className="text-sm font-extrabold text-[#0B162C]">
            سجل الواجبات والتكليفات ({items.length})
          </h4>
        </div>
        {gradedItems.length > 0 && (
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono-num text-xs font-bold text-emerald-700">
            متوسط درجات الواجبات: {avgPct}% ({gradedItems.length} مُصحَّح)
          </span>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-500">
          جارٍ تحميل سجل الواجبات...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-500">
          لا توجد تسليمات واجبات مسجلة لهذا الطالب حتى الآن.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-[#F7F9FC] text-slate-600">
              <tr>
                <th className="p-3">الواجب</th>
                <th className="p-3">النسخة</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">الدرجة</th>
                <th className="p-3">تاريخ التسليم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.assignmentId}>
                  <td className="p-3 font-bold text-[#0B162C]">{item.titleAr}</td>
                  <td className="p-3 font-mono-num text-slate-600">v{item.version}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                        item.isGradePublished
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : item.isLate
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-blue-200 bg-blue-50 text-[#2563EB]'
                      }`}
                    >
                      {item.statusLabelAr}
                    </span>
                  </td>
                  <td className="p-3 font-mono-num font-bold text-[#0B162C]">
                    {item.awardedGrade !== null ? (
                      <>
                        {item.awardedGrade} / {item.maximumGrade}
                        {!item.isGradePublished && (
                          <span className="mr-1 text-[10px] font-normal text-amber-700">(مسودة)</span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3 text-slate-500">
                    {item.submittedAt ? formatDateTimeAr(item.submittedAt) : 'مسودة'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
