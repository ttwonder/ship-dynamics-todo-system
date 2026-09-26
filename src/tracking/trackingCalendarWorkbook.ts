import JSZip from 'jszip';

/** Package the reviewed, self-authored VBA project without round-tripping worksheet data. */
export async function attachTrackingCalendar(
  xlsx: ArrayBuffer,
  project: Uint8Array,
  codeNames: { workbook: string; worksheets: string[] },
): Promise<ArrayBuffer> {
  const signature = [208, 207, 17, 224, 161, 177, 26, 225];
  if (project.length < 512 || signature.some((value, index) => project[index] !== value)) {
    throw new Error('月曆巨集元件無效；未產生模板。');
  }
  const zip = await JSZip.loadAsync(xlsx);
  const read = async (name: string) => {
    const part = zip.file(name);
    if (!part) throw new Error(`模板缺少 ${name}；未產生檔案。`);
    return part.async('string');
  };
  const [types, relationships, workbook, worksheet] = await Promise.all([
    read('[Content_Types].xml'), read('xl/_rels/workbook.xml.rels'),
    read('xl/workbook.xml'), read('xl/worksheets/sheet1.xml'),
  ]);
  const plainType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  if (!types.includes(plainType) || zip.file('xl/vbaProject.bin') || relationships.includes('rIdTrackingCalendar')) {
    throw new Error('模板封裝格式不符；未產生檔案。');
  }
  const withCodeName = (xml: string, tag: string, name: string) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('月曆元件名稱無效。');
    const pattern = new RegExp(`<${tag}\\b[^>]*>`);
    if (!pattern.test(xml)) {
      if (tag === 'sheetPr' && /<worksheet\b[^>]*>/.test(xml)) return xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr codeName="${name}"/>`);
      throw new Error(`模板缺少 ${tag}；未產生檔案。`);
    }
    return xml.replace(pattern, element => element.replace(/\s+codeName="[^"]*"/, '').replace(`<${tag}`, `<${tag} codeName="${name}"`));
  };
  zip.file('[Content_Types].xml', types.replace(plainType, 'application/vnd.ms-excel.sheet.macroEnabled.main+xml')
    .replace('</Types>', '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'));
  zip.file('xl/_rels/workbook.xml.rels', relationships.replace('</Relationships>',
    '<Relationship Id="rIdTrackingCalendar" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'));
  // ExcelJS sets filterPrivacy=1 by default. With VBA this triggers an unavoidable
  // Document Inspector save warning; this workbook-only flag is not macro security.
  const workbookXml = withCodeName(workbook, 'workbookPr', codeNames.workbook).replace(/\s+filterPrivacy="[^"]*"/, ' filterPrivacy="0"');
  zip.file('xl/workbook.xml', workbookXml);
  for (let i = 0; i < codeNames.worksheets.length; i++) {
    const name = `xl/worksheets/sheet${i + 1}.xml`;
    zip.file(name, withCodeName(i === 0 ? worksheet : await read(name), 'sheetPr', codeNames.worksheets[i]));
  }
  zip.file('xl/vbaProject.bin', project);
  return Uint8Array.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })).buffer;
}
