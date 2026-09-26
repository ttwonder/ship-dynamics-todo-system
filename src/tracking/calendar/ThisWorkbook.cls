VERSION 1.0 CLASS
BEGIN
  MultiUse = -1
END
Attribute VB_Name = "ThisWorkbook"
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = True
Option Explicit
Private Sub Workbook_SheetSelectionChange(ByVal Sh As Object, ByVal Target As Range)
    TrackingCalendar.CalendarSelect Sh, Target
End Sub
Private Sub Workbook_SheetBeforeDoubleClick(ByVal Sh As Object, ByVal Target As Range, Cancel As Boolean)
    If TrackingCalendar.CalendarEligible(Sh, Target) Then
        Cancel = True
        TrackingCalendar.CalendarShow Target
    End If
End Sub
Private Sub Workbook_SheetDeactivate(ByVal Sh As Object)
    TrackingCalendar.CalendarClose
End Sub
Private Sub Workbook_BeforeSave(ByVal SaveAsUI As Boolean, Cancel As Boolean)
    TrackingCalendar.CalendarClose
End Sub
Private Sub Workbook_BeforeClose(Cancel As Boolean)
    TrackingCalendar.CalendarClose
End Sub
Private Sub Workbook_BeforePrint(Cancel As Boolean)
    TrackingCalendar.CalendarClose
End Sub

'Native verification bridge: invokes the real double-click handler, not a mouse simulation.
Public Function CalendarDispatchDoubleClick(ByVal sheetName As String, ByVal address As String) As Boolean
    Dim canceled As Boolean, Sh As Worksheet, Target As Range
    Set Sh = Me.Worksheets(sheetName)
    Set Target = Sh.Range(address)
    Workbook_SheetBeforeDoubleClick Sh, Target, canceled
    CalendarDispatchDoubleClick = canceled
End Function
