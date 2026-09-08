 import jsPDF from "jspdf";
 import autoTable from "jspdf-autotable";
 
 interface PayslipEntry {
   code: string;
   description: string;
   reference: string;
   earnings: number | null;
   deductions: number | null;
 }
 
 interface PayslipData {
   company: {
     name: string;
     cnpj: string | null;
     logoUrl?: string | null;
   };
   collaborator: {
     code: string;
     name: string;
     cpf: string;
     admissionDate: string;
     position: string;
     department: string;
   };
   period: {
     month: number;
     year: number;
   };
   entries: PayslipEntry[];
   totals: {
     earnings: number;
     deductions: number;
     netPay: number;
   };
   footer: {
     baseSalary: number;
     inssBase: number;
     fgtsBase: number;
     fgtsValue: number;
     irpfBase: number;
   };
 }
 
 const formatCurrencyPDF = (value: number): string => {
   return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
 };
 
 const monthNames = [
   "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
   "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
 ];
 
 // Entry type to code mapping
 const typeCodes: Record<string, string> = {
   salario_base: "011",
   hora_extra: "020",
   beneficio: "030",
   bonificacao: "040",
   carro_agregado: "045",
   atestado: "050",
   adiantamento: "100",
   desconto: "200",
   falta: "210",
   inss: "310",
   irpf: "320",
   fgts: "400",
   custo: "500",
   despesa: "600",
 };
 
 // Entry type to description mapping
 const typeDescriptions: Record<string, string> = {
   salario_base: "Salário-Base",
   hora_extra: "Hora extra",
   beneficio: "Benefício",
   falta: "Falta",
   atestado: "Atestado",
   adiantamento: "Adiantamento",
   bonificacao: "Bonificação",
   carro_agregado: "Veículo",
   desconto: "Desconto",
   inss: "INSS",
   irpf: "IRPF",
   fgts: "FGTS",
   custo: "Custo",
   despesa: "Despesa",
 };

 // Types that are earnings (proventos)
  const earningsTypes = ["salario_base", "hora_extra", "beneficio", "bonificacao", "carro_agregado", "atestado"];

  // Types that are deductions (descontos)
  const deductionTypes = ["desconto", "falta", "adiantamento", "inss", "irpf", "despesa", "custo"];

 // Helper to load image as base64
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
   } catch {
     return null;
   }
 };
 
 export const generatePayslipPDF = async (data: PayslipData): Promise<void> => {
   const doc = new jsPDF();
   const pageWidth = doc.internal.pageSize.getWidth();
   const margin = 10;
   const contentWidth = pageWidth - margin * 2;
   let y = margin;
   
    doc.setLineWidth(0.1);
    doc.setDrawColor(0, 0, 0);

    // Load logo if available
   let logoBase64: string | null = null;
   if (data.company.logoUrl) {
     logoBase64 = await loadImageAsBase64(data.company.logoUrl);
   }
 
   // ============ HEADER ROW ============
   const headerRowHeight = 14;
   
   doc.rect(margin, y, contentWidth * 0.55, headerRowHeight, "S");
   
   let textStartX = margin + 4;
   if (logoBase64) {
     try {
        doc.addImage(logoBase64, "PNG", margin + 2, y + 2, 10, 10);
        textStartX = margin + 14;
     } catch (e) {
       console.error("Error adding logo to PDF:", e);
     }
   }
   
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Recibo de Pagamento", textStartX, y + 5);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text("( Folha de Pagamento )", textStartX, y + 10);
 
   doc.rect(margin + contentWidth * 0.55, y, contentWidth * 0.45, headerRowHeight, "S");
    doc.setFontSize(6);
    doc.text("Data e Assinatura", margin + contentWidth * 0.55 + 3, y + 5);
    doc.text("____/____/____                    _________________________________", margin + contentWidth * 0.55 + 3, y + 10);
 
   y += headerRowHeight;
 
   // ============ ROW 2: Empregador | Inscrição | Admissão | Competência ============
    const row2Height = 10;
    const col1Width = contentWidth * 0.4;
    const col2Width = contentWidth * 0.25;
    const col3Width = contentWidth * 0.15;
    const col4Width = contentWidth * 0.2;

    doc.setFontSize(6);
    doc.rect(margin, y, col1Width, row2Height, "S");
    doc.text("Empregador", margin + 2, y + 3.5);
    doc.text(data.company.name.substring(0, 45), margin + 2, y + 7.5);

    doc.rect(margin + col1Width, y, col2Width, row2Height, "S");
    doc.text("Inscrição", margin + col1Width + 2, y + 3.5);
    doc.text(data.company.cnpj || "-", margin + col1Width + 2, y + 7.5);

    doc.rect(margin + col1Width + col2Width, y, col3Width, row2Height, "S");
    doc.text("Admissão", margin + col1Width + col2Width + 2, y + 3.5);
    doc.text(data.collaborator.admissionDate, margin + col1Width + col2Width + 2, y + 7.5);

    doc.rect(margin + col1Width + col2Width + col3Width, y, col4Width, row2Height, "S");
    doc.text("Competência", margin + col1Width + col2Width + col3Width + 2, y + 3.5);
    doc.text(`${monthNames[data.period.month - 1]} de ${data.period.year}`, margin + col1Width + col2Width + col3Width + 2, y + 7.5);
 
   y += row2Height;
 
   // ============ ROW 3: Empregado | Cargo | Lotação ============
    const row3Height = 10;
    const empCol1 = contentWidth * 0.5;
    const empCol2 = contentWidth * 0.25;
    const empCol3 = contentWidth * 0.25;

    doc.rect(margin, y, empCol1, row3Height, "S");
    doc.text("Empregado", margin + 2, y + 3.5);
    doc.text(`${data.collaborator.code} ${data.collaborator.name.substring(0, 50)}`, margin + 2, y + 7.5);

    doc.rect(margin + empCol1, y, empCol2, row3Height, "S");
    doc.text("Cargo", margin + empCol1 + 2, y + 3.5);
    doc.text(data.collaborator.position.substring(0, 30), margin + empCol1 + 2, y + 7.5);

    doc.rect(margin + empCol1 + empCol2, y, empCol3, row3Height, "S");
    doc.text("Lotação", margin + empCol1 + empCol2 + 2, y + 3.5);
    doc.text(data.collaborator.department.substring(0, 25) || "GERAL", margin + empCol1 + empCol2 + 2, y + 7.5);
 
   y += row3Height;
 
   // ============ ROW 4: CPF | Banco | Agência | Conta | Tipo Conta ============
    const row4Height = 10;
    const cpfCol = contentWidth * 0.2;
    const bankCol = contentWidth * 0.2;
    const agCol = contentWidth * 0.2;
    const contaCol = contentWidth * 0.2;
    const tipoCol = contentWidth * 0.2;

    doc.rect(margin, y, cpfCol, row4Height, "S");
    doc.text("CPF:", margin + 2, y + 3.5);
    doc.text(data.collaborator.cpf, margin + 2, y + 7.5);

    doc.rect(margin + cpfCol, y, bankCol, row4Height, "S");
    doc.text("Banco", margin + cpfCol + 2, y + 3.5);

    doc.rect(margin + cpfCol + bankCol, y, agCol, row4Height, "S");
    doc.text("Agência", margin + cpfCol + bankCol + 2, y + 3.5);

    doc.rect(margin + cpfCol + bankCol + agCol, y, contaCol, row4Height, "S");
    doc.text("Conta", margin + cpfCol + bankCol + agCol + 2, y + 3.5);

    doc.rect(margin + cpfCol + bankCol + agCol + contaCol, y, tipoCol, row4Height, "S");
    doc.text("Tipo de Conta", margin + cpfCol + bankCol + agCol + contaCol + 2, y + 3.5);

    y += row4Height;
 
   // ============ Discriminação das Verbas Header ============
    const discHeaderHeight = 6;
    doc.rect(margin, y, contentWidth, discHeaderHeight, "S");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text("Discriminação das Verbas", pageWidth / 2, y + 4, { align: "center" });
    doc.setFont("helvetica", "normal");
    y += discHeaderHeight;
 
   // ============ Entries Table ============
   const tableData = data.entries.map((entry) => [
     entry.code,
     entry.description,
     entry.reference,
     entry.earnings ? formatCurrencyPDF(entry.earnings) : "",
     entry.deductions ? formatCurrencyPDF(entry.deductions) : "",
   ]);
 
    // Dynamic rows - no empty padding rows
 
   autoTable(doc, {
     startY: y,
     head: [["Cod.", "Descrição", "Referência", "Provento", "Desconto"]],
     body: tableData,
     theme: "plain",
     headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontSize: 6,
        fontStyle: "normal",
        lineWidth: 0.1,
        lineColor: [0, 0, 0],
        cellPadding: 1,
      },
      styles: {
        fontSize: 6,
        cellPadding: 1,
        lineWidth: 0.1,
        lineColor: [0, 0, 0],
        font: "helvetica",
        fontStyle: "normal",
      },
      columnStyles: {
        0: { cellWidth: 20, halign: "center" },
        1: { cellWidth: 80 },
        2: { cellWidth: 30, halign: "center" },
        3: { cellWidth: 30, halign: "right" },
        4: { cellWidth: 30, halign: "right" },
      },
      margin: { left: margin, right: margin },
      tableLineWidth: 0.1,
      tableLineColor: [0, 0, 0],
    });
 
   y = (doc as any).lastAutoTable.finalY;
 
   // ============ TOTALS ROW ============
   const totalsRowHeight = 6;
   
   doc.rect(margin, y, contentWidth * 0.55, totalsRowHeight * 3, "S");
   
   doc.rect(margin + contentWidth * 0.55, y, contentWidth * 0.25, totalsRowHeight, "S");
    doc.setFontSize(6);
   doc.setFont("helvetica", "normal");
    doc.text("Total de Proventos", margin + contentWidth * 0.55 + 2, y + 4);
    
    doc.rect(margin + contentWidth * 0.8, y, contentWidth * 0.2, totalsRowHeight, "S");
    doc.text(formatCurrencyPDF(data.totals.earnings), margin + contentWidth - 2, y + 4, { align: "right" });
   
   y += totalsRowHeight;
   
    doc.rect(margin + contentWidth * 0.55, y, contentWidth * 0.25, totalsRowHeight, "S");
    doc.text("Total de Descontos", margin + contentWidth * 0.55 + 2, y + 4);
    
    doc.rect(margin + contentWidth * 0.8, y, contentWidth * 0.2, totalsRowHeight, "S");
    doc.text(formatCurrencyPDF(data.totals.deductions), margin + contentWidth - 2, y + 4, { align: "right" });
   
   y += totalsRowHeight;
   
    doc.rect(margin + contentWidth * 0.55, y, contentWidth * 0.25, totalsRowHeight, "S");
    doc.setFont("helvetica", "bold");
    doc.text("Líquido a Receber", margin + contentWidth * 0.55 + 2, y + 4);
    
    doc.rect(margin + contentWidth * 0.8, y, contentWidth * 0.2, totalsRowHeight, "S");
    doc.text(formatCurrencyPDF(data.totals.netPay), margin + contentWidth - 2, y + 4, { align: "right" });
 
   y += totalsRowHeight + 2;
 
   // ============ FOOTER - Tax Bases ============
    const footerHeight = 10;
    const footerColWidth = contentWidth / 6;

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");

    doc.rect(margin, y, footerColWidth, footerHeight, "S");
    doc.text("Salário Contratual", margin + 2, y + 3.5);
    doc.text(formatCurrencyPDF(data.footer.baseSalary), margin + 2, y + 7.5);

    doc.rect(margin + footerColWidth, y, footerColWidth, footerHeight, "S");
    doc.text("Base de Cálculo do INSS", margin + footerColWidth + 2, y + 3.5);
    doc.text(formatCurrencyPDF(data.footer.inssBase), margin + footerColWidth + 2, y + 7.5);

    doc.rect(margin + footerColWidth * 2, y, footerColWidth, footerHeight, "S");
    doc.text("Base de Cálculo do FGTS", margin + footerColWidth * 2 + 2, y + 3.5);
    doc.text(formatCurrencyPDF(data.footer.fgtsBase), margin + footerColWidth * 2 + 2, y + 7.5);

    doc.rect(margin + footerColWidth * 3, y, footerColWidth, footerHeight, "S");
    doc.text("FGTS", margin + footerColWidth * 3 + 2, y + 3.5);
    doc.text(formatCurrencyPDF(data.footer.fgtsValue), margin + footerColWidth * 3 + 2, y + 7.5);

    doc.rect(margin + footerColWidth * 4, y, footerColWidth, footerHeight, "S");
    doc.text("FGTS Contribuição Social", margin + footerColWidth * 4 + 2, y + 3.5);

    doc.rect(margin + footerColWidth * 5, y, footerColWidth, footerHeight, "S");
    doc.text("Base de Cálculo do IRRF(S)", margin + footerColWidth * 5 + 2, y + 3.5);
    doc.text(formatCurrencyPDF(data.footer.irpfBase), margin + footerColWidth * 5 + 2, y + 7.5);
 
   const fileName = `recibo_${data.collaborator.name.replace(/\s+/g, "_")}_${data.period.month.toString().padStart(2, "0")}_${data.period.year}.pdf`;
   doc.save(fileName);
 };
 
 // Helper function to convert payroll entries to payslip format
 export const convertEntriesToPayslipData = (
   entries: any[],
   company: { name: string; cnpj: string | null; logoUrl?: string | null },
   collaborator: {
     id: string;
     name: string;
     cpf: string;
     admission_date: string | null;
     position?: { name: string } | null;
     team?: { name: string } | null;
   },
   month: number,
   year: number
 ): PayslipData => {
   const payslipEntries: PayslipEntry[] = [];
   let totalEarnings = 0;
   let totalDeductions = 0;
   let baseSalary = 0;
   let fgtsValue = 0;
 
   entries.forEach((entry) => {
     const type = entry.type as string;
     const code = typeCodes[type] || "999";
     const description = entry.description || typeDescriptions[type] || type;
     const value = Number(entry.value);
 
     if (type === "salario_base") {
       baseSalary += value;
     }
 
     if (type === "fgts") {
       fgtsValue += value;
       return;
     }
 
     const isEarning = earningsTypes.includes(type);
     const isDeduction = deductionTypes.includes(type);
 
     if (isEarning) {
       totalEarnings += value;
       payslipEntries.push({
         code,
         description,
         reference: type === "salario_base" ? "30 dia(s)" : entry.description?.match(/\d+%/) ? entry.description.match(/\d+%/)[0] : "-",
         earnings: value,
         deductions: null,
       });
     } else if (isDeduction) {
       totalDeductions += value;
       const percentMatch = entry.description?.match(/(\d+(?:,\d+)?%)/);
       payslipEntries.push({
         code,
         description,
         reference: percentMatch ? percentMatch[1] : "-",
         earnings: null,
         deductions: value,
       });
     }
   });
 
   payslipEntries.sort((a, b) => {
     if (a.earnings && !b.earnings) return -1;
     if (!a.earnings && b.earnings) return 1;
     return 0;
   });
 
   const netPay = totalEarnings - totalDeductions;
   const inssBase = baseSalary;
   const fgtsBase = baseSalary;
   const irpfBase = baseSalary;
 
   return {
     company: {
       name: company.name,
       cnpj: company.cnpj,
       logoUrl: company.logoUrl,
     },
     collaborator: {
       code: collaborator.id.substring(0, 6).toUpperCase(),
       name: collaborator.name,
       cpf: collaborator.cpf,
       admissionDate: collaborator.admission_date
         ? new Date(collaborator.admission_date).toLocaleDateString("pt-BR")
         : "-",
       position: collaborator.position?.name || "-",
       department: collaborator.team?.name || "-",
     },
     period: {
       month,
       year,
     },
     entries: payslipEntries,
     totals: {
       earnings: totalEarnings,
       deductions: totalDeductions,
       netPay,
     },
     footer: {
       baseSalary,
       inssBase,
       fgtsBase,
       fgtsValue,
       irpfBase,
     },
   };
 };
