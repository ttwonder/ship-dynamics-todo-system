"""Windows Excel acceptance of browser-downloaded assignment workbooks.
Run: python scripts/verify-management-assignment-excel-native.py <browser-evidence-dir>
Uses installed Microsoft Excel; opens read-only and never saves the workbook.
"""
from pathlib import Path
import json
import sys
import win32com.client

root = Path(sys.argv[1]).resolve()
evidence = json.loads((root / 'evidence.json').read_text(encoding='utf-8'))
assert evidence['status'] == 'PASS'
excel = win32com.client.DispatchEx('Excel.Application')
excel.Visible = False
excel.DisplayAlerts = False
excel.AutomationSecurity = 3
receipts = []
try:
    for index, name in enumerate(['people-download.xlsx', 'vessels-download.xlsx']):
        book = excel.Workbooks.Open(str(root / name), UpdateLinks=0, ReadOnly=True, IgnoreReadOnlyRecommended=True, CorruptLoad=0)
        try:
            assert book.Worksheets.Count == 2 and book.ReadOnly
            ship, people = book.Worksheets(1), book.Worksheets(2)
            assert ship.Name == '船舶分管' and people.Name == '人員分管'
            assert ship.UsedRange.Rows.Count == 4 + evidence['rowCount']
            assert ship.UsedRange.Columns.Count == 6 + len(evidence['departments'])
            assert ship.Range('E5').Value == '測試督導甲、林督乙 （測試代理丙*）'
            assert ship.UsedRange.WrapText is True and ship.UsedRange.ShrinkToFit is False, 'all cells must wrap without shrink-to-fit, not just a specially named department'
            assert people.UsedRange.WrapText is True and people.UsedRange.ShrinkToFit is False
            assert not ship.Range('E5').HasFormula
            assert ship.Columns(5).ColumnWidth > ship.Columns(6).ColumnWidth * 2
            assert 0 < ship.Columns(5).ColumnWidth < 13, 'native font metrics differ from OOXML width; still the narrowed supervisor column'
            assert ship.Cells(3, ship.UsedRange.Columns.Count-1).Value == '年份'
            assert ship.Cells(3, ship.UsedRange.Columns.Count).Value == '噸數'
            assert ship.Cells(5, ship.UsedRange.Columns.Count-1).Value == '2021.06'
            assert ship.Cells(5, ship.UsedRange.Columns.Count).Value == '2.0萬'
            assert ship.Range('F7').MergeArea.Rows.Count == evidence['rowCount'] - 3, 'native office cell merge follows all adjacent extra vessels'
            setup = ship.PageSetup
            assert setup.Orientation == 1 and setup.PaperSize == 9
            assert setup.Zoom is False and setup.FitToPagesWide == 1 and setup.FitToPagesTall == 1
            assert not setup.PrintTitleRows, 'single-page sheet must not reserve repeated title rows'
            values = '\n'.join(str(cell or '') for row in ship.UsedRange.Value for cell in row)
            for vessel in evidence['expectedNames']:
                assert (vessel['english'] or vessel['chinese']) in values
            for label in evidence['departments']:
                assert label in values
            for forbidden in ['來源版本', 'Rev.', 'PRIVATE_', 'QA UNSAVED NAME', 'INACTIVE SHIP', '停用人員戊', '未激活代理丁*']:
                assert forbidden not in values
            people_values = '\n'.join(str(cell or '') for row in people.UsedRange.Value for cell in row)
            assert '未分管人員己' in people_values and '已激活代管' in people_values and '預設代管' in people_values
            assert '未激活代理丁' in values and '測試代理丙*' in values
            assert 'PRIVATE_' not in people_values
            pdf = 'excel-ships.pdf' if index == 0 else 'excel-ships-vessel-entry.pdf'
            ship.ExportAsFixedFormat(0, str(root / pdf))
            receipts.append({'file': name, 'ship_rows': evidence['rowCount'], 'normal_open': True,
                             'read_only': True, 'portrait_a4': True, 'fit_wide': 1, 'fit_tall': 1, 'pdf': pdf})
        finally:
            book.Close(SaveChanges=False)
finally:
    excel.Quit()
(root / 'native-excel.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': 'PASS', 'native_excel_files': len(receipts), 'ship_rows_per_file': evidence['rowCount']}))
