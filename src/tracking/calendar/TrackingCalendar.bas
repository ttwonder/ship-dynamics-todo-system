Attribute VB_Name = "TrackingCalendar"
Option Explicit
Private Const Prefix As String = "__tc_"
Private mTarget As Range
Private mPicked As Date
Private mMonth As Date
Private mClear As Boolean
Private mBusy As Boolean
Private mError As String
Private mScale As Double
Private mOriginX As Double
Private mOriginY As Double

Private Function U(ByVal hexes As String) As String
    Dim v As Variant
    For Each v In Split(hexes, " ")
        U = U & ChrW(CLng("&H" & v))
    Next
End Function

Public Function CalendarEligible(ByVal Sh As Object, ByVal Target As Range) As Boolean
    On Error GoTo Done
    If Not Sh.Parent Is ThisWorkbook Then Exit Function
    If Sh.Name <> U("586B 5BEB 8CC7 6599") Then Exit Function
    If Target.CountLarge <> 1 Then Exit Function
    If Target.Row < 5 Or Target.Row > 10000 Then Exit Function
    Select Case CStr(Sh.Cells(3, Target.Column).Value2)
        Case "tracking:applicationDate", "tracking:expectedDate", "tracking:actualDeliveryDate", "tracking:completionDate"
            CalendarEligible = True
    End Select
Done:
End Function

Private Function ReadDate(ByVal r As Range, ByRef result As Date) As Boolean
    Dim v As Variant, n As Double, d As Date
    On Error GoTo Done
    v = r.Value2
    If IsEmpty(v) Or IsError(v) Then Exit Function
    If VarType(v) = vbString Then
        If Len(v) <> 10 Or Mid$(v, 5, 1) <> "-" Or Mid$(v, 8, 1) <> "-" Then Exit Function
        d = DateSerial(CInt(Left$(v, 4)), CInt(Mid$(v, 6, 2)), CInt(Right$(v, 2)))
        If Format$(d, "yyyy-mm-dd") <> v Then Exit Function
    ElseIf IsNumeric(v) And VarType(v) <> vbBoolean Then
        n = Int(CDbl(v))
        If ThisWorkbook.Date1904 Then
            n = n + 1462
        Else
            If n = 60 Then Exit Function
            If n < 60 Then n = n + 1
        End If
        d = CDate(n)
    Else
        Exit Function
    End If
    If Year(d) < 1900 Then Exit Function
    result = d
    ReadDate = True
Done:
End Function

Public Sub CalendarSelect(ByVal Sh As Object, ByVal Target As Range)
    If mBusy Then Exit Sub
    CalendarClose
    If CalendarEligible(Sh, Target) Then CalendarShow Target
End Sub

Public Sub CalendarShow(ByVal Target As Range)
    On Error GoTo Failed
    If Not CalendarEligible(Target.Parent, Target) Then Exit Sub
    CalendarClose
    Set mTarget = Target
    mPicked = Date
    Call ReadDate(Target, mPicked)
    mMonth = DateSerial(Year(mPicked), Month(mPicked), 1)
    mClear = False
    mError = ""
    Render
    Exit Sub
Failed:
    mError = CStr(Err.Number) & ": " & Err.Description
    CalendarClose
End Sub

Private Sub RemoveShapes()
    Dim Sh As Worksheet, i As Long
    For Each Sh In ThisWorkbook.Worksheets
        For i = Sh.Shapes.Count To 1 Step -1
            If Left$(Sh.Shapes(i).Name, Len(Prefix)) = Prefix Then Sh.Shapes(i).Delete
        Next
    Next
End Sub

Public Sub CalendarClose()
    On Error Resume Next
    RemoveShapes
    Set mTarget = Nothing
End Sub

Private Sub Box(ByVal key As String, ByVal caption As String, ByVal action As String, ByVal x As Double, ByVal y As Double, ByVal w As Double, ByVal h As Double, Optional ByVal selected As Boolean = False)
    Dim s As Shape
    Set s = mTarget.Parent.Shapes.AddShape(1, mOriginX + (x - mOriginX) * mScale, mOriginY + (y - mOriginY) * mScale, w * mScale, h * mScale)
    s.Name = Prefix & key
    s.AlternativeText = action
    s.Placement = xlFreeFloating
    s.DrawingObject.PrintObject = False
    s.Line.ForeColor.RGB = RGB(210, 218, 226)
    s.Fill.ForeColor.RGB = RGB(255, 255, 255)
    s.TextFrame2.TextRange.Text = caption
    s.TextFrame2.TextRange.Font.Name = "Microsoft JhengHei"
    s.TextFrame2.TextRange.Font.Size = 11 * mScale
    s.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(30, 43, 60)
    s.TextFrame2.TextRange.ParagraphFormat.Alignment = 2
    s.TextFrame2.VerticalAnchor = 3
    s.TextFrame2.MarginLeft = 1
    s.TextFrame2.MarginRight = 1
    s.TextFrame2.MarginTop = 1
    s.TextFrame2.MarginBottom = 1
    If selected Then s.Fill.ForeColor.RGB = RGB(183, 218, 255)
    If Len(action) > 0 Then s.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!TrackingCalendar.CalendarAction"
End Sub

Private Sub Render()
    Dim x As Double, y As Double, d As Long, slot As Long, days As Long, first As Long
    Dim v As Range, labels As Variant, usableWidth As Double, usableHeight As Double
    If mTarget Is Nothing Then Exit Sub
    RemoveShapes
    Set v = ActiveWindow.ActivePane.VisibleRange
    'The final visible row/column may be clipped. Fit the complete picker inside
    'the scrollable pane, not behind frozen headers or the status bar.
    usableWidth = v.Width - v.Columns(v.Columns.Count).Width - 8
    usableHeight = v.Height - v.Rows(v.Rows.Count).Height - 8
    mScale = 1
    If usableWidth / 280 < mScale Then mScale = usableWidth / 280
    If usableHeight / 310 < mScale Then mScale = usableHeight / 310
    If mScale <= 0 Then CalendarClose: Exit Sub
    x = mTarget.Left + mTarget.Width + 6
    If x + 280 * mScale > v.Left + usableWidth Then x = v.Left + usableWidth - 280 * mScale
    If x < v.Left Then x = v.Left + 4
    y = mTarget.Top + mTarget.Height + 4
    If y + 310 * mScale > v.Top + usableHeight Then y = v.Top + usableHeight - 310 * mScale
    If y < v.Top Then y = v.Top + 4
    mOriginX = x
    mOriginY = y
    Box "panel", "", "", x, y, 280, 310
    Box "title", Format$(mMonth, "yyyy-mm") & "  " & U("9078 64C7 65E5 671F"), "", x + 4, y + 4, 272, 26
    labels = Array("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa")
    For d = 0 To 6
        Box "week" & d, labels(d), "", x + 7 + d * 38, y + 62, 36, 24
    Next
    first = Weekday(mMonth, vbSunday) - 1
    If Year(mMonth) = 9999 And Month(mMonth) = 12 Then
        days = 31
    Else
        days = Day(DateSerial(Year(mMonth), Month(mMonth) + 1, 0))
    End If
    For d = 1 To days
        slot = first + d - 1
        Box "day" & Format$(d, "00"), CStr(d), "day:" & Format$(DateSerial(Year(mMonth), Month(mMonth), d), "yyyy-mm-dd"), x + 7 + (slot Mod 7) * 38, y + 89 + (slot \ 7) * 26, 36, 24, DateSerial(Year(mMonth), Month(mMonth), d) = mPicked
    Next
    If mClear Then
        Box "picked", U("78BA 8A8D 5F8C 6E05 7A7A"), "", x + 7, y + 246, 266, 25
    Else
        Box "picked", U("5DF2 9078") & ": " & Format$(mPicked, "yyyy-mm-dd"), "", x + 7, y + 246, 266, 25
    End If
    Box "prev", U("4E0A 4E00 6708"), "prev", x + 7, y + 32, 86, 26
    Box "today", U("4ECA 5929"), "today", x + 97, y + 32, 86, 26
    Box "next", U("4E0B 4E00 6708"), "next", x + 187, y + 32, 86, 26
    Box "clear", U("6E05 7A7A"), "clear", x + 7, y + 276, 86, 28
    Box "cancel", U("53D6 6D88"), "cancel", x + 97, y + 276, 86, 28
    Box "confirm", U("78BA 8A8D"), "confirm", x + 187, y + 276, 86, 28, True
End Sub

Public Sub CalendarAction()
    Dim caller As Variant
    On Error GoTo Failed
    caller = Application.Caller
    If VarType(caller) <> vbString Or mTarget Is Nothing Then Exit Sub
    If Left$(CStr(caller), Len(Prefix)) <> Prefix Then Exit Sub
    CalendarCommand mTarget.Parent.Shapes(CStr(caller)).AlternativeText
    Exit Sub
Failed:
    mError = CStr(Err.Number) & ": " & Err.Description
    CalendarClose
End Sub

Public Sub CalendarCommand(ByVal action As String)
    Dim d As Date, iso As String, v As Double, oldEvents As Boolean
    oldEvents = Application.EnableEvents
    On Error GoTo Failed
    If mTarget Is Nothing Then Exit Sub
    If Not CalendarEligible(mTarget.Parent, mTarget) Then CalendarClose: Exit Sub
    If Not ActiveWorkbook Is ThisWorkbook Then CalendarClose: Exit Sub
    If Not ActiveSheet Is mTarget.Parent Then CalendarClose: Exit Sub
    If ActiveCell.Address <> mTarget.Address Then CalendarClose: Exit Sub
    Select Case action
        Case "cancel": CalendarClose
        Case "prev"
            If Year(mMonth) = 1900 And Month(mMonth) = 1 Then Exit Sub
            mMonth = DateAdd("m", -1, mMonth)
            Render
        Case "next"
            If Year(mMonth) = 9999 And Month(mMonth) = 12 Then Exit Sub
            mMonth = DateAdd("m", 1, mMonth)
            Render
        Case "today"
            mPicked = Date
            mMonth = DateSerial(Year(mPicked), Month(mPicked), 1)
            mClear = False
            Render
        Case "clear"
            mClear = True
            Render
        Case "confirm"
            mBusy = True
            Application.EnableEvents = False
            If mClear Then
                mTarget.ClearContents
            Else
                v = CDbl(mPicked)
                If ThisWorkbook.Date1904 Then
                    v = v - 1462
                ElseIf v < 61 Then
                    v = v - 1
                End If
                mTarget.NumberFormat = "yyyy-mm-dd"
                mTarget.Value2 = v
            End If
            Application.EnableEvents = oldEvents
            mBusy = False
            CalendarClose
        Case Else
            If Len(action) <> 14 Or Left$(action, 4) <> "day:" Then Exit Sub
            iso = Mid$(action, 5)
            If Not iso Like "####-##-##" Then Exit Sub
            d = DateSerial(CInt(Left$(iso, 4)), CInt(Mid$(iso, 6, 2)), CInt(Right$(iso, 2)))
            If Format$(d, "yyyy-mm-dd") <> iso Or Year(d) < 1900 Then Exit Sub
            mPicked = d
            mMonth = DateSerial(Year(d), Month(d), 1)
            mClear = False
            Render
    End Select
    Exit Sub
Failed:
    mError = CStr(Err.Number) & ": " & Err.Description
    Application.EnableEvents = oldEvents
    mBusy = False
    CalendarClose
End Sub

Public Function CalendarDispatchDoubleClick(ByVal sheetName As String, ByVal address As String) As Boolean
    'Application.Run discards return values from document-class members; return through a standard module.
    CalendarDispatchDoubleClick = ThisWorkbook.CalendarDispatchDoubleClick(sheetName, address)
End Function

Public Function CalendarState() As String
    If mTarget Is Nothing Then
        CalendarState = "{""open"":false,""error"":""" & Replace(mError, """", "'") & """}"
    Else
        CalendarState = "{""open"":true,""target"":""" & mTarget.Address(False, False) & """,""picked"":""" & Format$(mPicked, "yyyy-mm-dd") & """,""month"":""" & Format$(mMonth, "yyyy-mm") & """,""clear"":" & LCase$(CStr(mClear)) & "}"
    End If
End Function
