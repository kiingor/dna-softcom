import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { EXAM_EXPORT_COLUMNS, type ExamExportData } from "./examExportData";

const loadImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
};

export const exportExamsToPDF = async (data: ExamExportData) => {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 10;

  if (data.logoUrl) {
    const logoBase64 = await loadImageAsBase64(data.logoUrl);
    if (logoBase64) {
      try { doc.addImage(logoBase64, "PNG", margin, y, 16, 16); } catch { /* O relatório pode ser gerado sem logo. */ }
    }
  }

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(data.companyName, margin + 19, y + 5);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  if (data.companyCnpj) doc.text(`CNPJ: ${data.companyCnpj}`, margin + 19, y + 10);
  doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, pageWidth - margin, y + 5, { align: "right" });

  y += 18;
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Relatório de Exames Ocupacionais", pageWidth / 2, y, { align: "center" });
  y += 8;

  const tableData = data.entries.map((entry) => EXAM_EXPORT_COLUMNS.map((column) => entry[column]));

  autoTable(doc, {
    startY: y,
    head: [[...EXAM_EXPORT_COLUMNS]],
    body: tableData,
    theme: "striped",
    headStyles: { fillColor: [99, 102, 241] },
    margin: { left: margin, right: margin },
    styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 39 },
      1: { cellWidth: 23 },
      2: { cellWidth: 24 },
      3: { cellWidth: 44 },
      4: { cellWidth: 22 },
      5: { cellWidth: 23 },
      6: { cellWidth: 28 },
      7: { cellWidth: 10 },
      8: { cellWidth: 18 },
      9: { cellWidth: 18 },
      10: { cellWidth: 20 },
    },
  });

  doc.save(`exames_ocupacionais_${new Date().toISOString().slice(0, 10)}.pdf`);
};

export const exportExamsToExcel = (data: ExamExportData) => {
  const wb = XLSX.utils.book_new();
  const wsData = [
    [...EXAM_EXPORT_COLUMNS],
    ...data.entries.map((entry) => EXAM_EXPORT_COLUMNS.map((column) => entry[column])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [42, 24, 24, 54, 20, 14, 24, 8, 14, 14, 14].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Exames");
  XLSX.writeFile(wb, `exames_ocupacionais_${new Date().toISOString().slice(0, 10)}.xlsx`);
};
