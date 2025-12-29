# Time Clock Agent

## Purpose
Manage the employee time clock feature including clock in/out, IP verification, timecard generation, and overtime tracking.

## Responsibilities
- Clock in/out functionality with IP verification
- Track time entries in Firebase
- Calculate hours per pay period (bi-weekly, payday every 2 weeks)
- Overtime alerts (over 8hrs/day or 40hrs/week)
- Digital timecards for admin/bookkeeper view
- Export timecards for payroll submission

## Key Features
1. **Simple Clock In/Out** - Employees only clock out for lunch (2x 15min paid breaks included)
2. **IP Verification** - Must be on work WiFi to clock in/out
3. **Hours Display** - Show hours logged in current pay period
4. **Overtime Popup** - Alert when approaching/hitting overtime
5. **Admin Timecards** - Ryan can view all staff timecards
6. **Bookkeeper Access** - Read-only access to timecards for payroll

## Firebase Structure
```
timeclock/
  entries/
    {oderId}/
      oderId
      odserName
      type: "in" | "out"
      timestamp
      ipAddress
      date
  settings/
    authorizedIPs: []
    overtimeThreshold: 40
```

## Integration Points
- Uses existing ROLES system for employee identification
- Uses existing Firebase config
- Adds new "timeclock" tab or section
