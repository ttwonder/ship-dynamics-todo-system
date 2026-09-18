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
            assert ship.UsedRange.Rows.Count == 4 + evidence['rowCount'] + 2
            assert ship.UsedRange.Columns.Count == 6 + len(evidence['departments'])
            assert ship.Range('E5').Value == '測試督導甲、林督乙\n(測試代理丙*)'
            for group in evidence['expectedGroupSpans']:
                cell = ship.Cells(group['row'] + 5, group['column'] + 1)
                area = cell.MergeArea
                assert cell.Value == group['text']
                assert area.Row == group['row'] + 5 and area.Column == group['column'] + 1
                assert area.Rows.Count == group['rows'] and area.Columns.Count == 1, ('fleet/type merge', group)
            columns = ship.UsedRange.Columns.Count
            for column in range(1, columns + 1):
                body = ship.Range(ship.Cells(5, column), ship.Cells(4 + evidence['rowCount'], column))
                shrink = column in [1, 2, 4, columns - 1, columns]
                assert body.WrapText is (not shrink) and body.ShrinkToFit is shrink, ('column policy', column)
                if 5 <= column <= columns - 2:
                    assert body.HorizontalAlignment == -4108, ('department not centered', column)
            assert ship.Range(ship.Cells(1, 1), ship.Cells(4, columns)).WrapText is True
            for offset, note in enumerate(['註：()為職務代理人', '註2：船隊加油業務(燃油/潤滑油)改為資材組-王梓名負責。']):
                cell = ship.Cells(5 + evidence['rowCount'] + offset, 1)
                assert cell.Value == note and not cell.HasFormula
                assert cell.MergeArea.Columns.Count == columns
                assert cell.WrapText is True and cell.ShrinkToFit is False
                assert cell.HorizontalAlignment == -4131, 'notes must remain left aligned'
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
                             'read_only': True, 'fleet_type_merges': True, 'bottom_notes': True, 'portrait_a4': True, 'fit_wide': 1, 'fit_tall': 1, 'pdf': pdf})
        finally:
            book.Close(SaveChanges=False)
finally:
    excel.Quit()
(root / 'native-excel.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': 'PASS', 'native_excel_files': len(receipts), 'ship_rows_per_file': evidence['rowCount']}))
