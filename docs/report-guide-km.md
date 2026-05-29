# មគ្គុទ្ទេសក៍ការបង្កើត Report — Prism

> ឯកសារនេះបង្ហាញពីរបៀបបង្កើត Report dynamic (ដូចជា CPO Monthly Report) និងការប្រើ Custom Script លើ element នីមួយៗ។

---

## តារាងមាតិកា

1. [ការបង្កើត Report ថ្មី](#១-ការបង្កើត-report-ថ្មី)
2. [Canvas Editor — ការណែនាំ](#២-canvas-editor--ការណែនាំ)
3. [Element Types](#៣-element-types)
4. [បន្ថែម Heading ពី API](#៤-បន្ថែម-heading-ពី-api)
5. [បន្ថែម KPI Widget](#៥-បន្ថែម-kpi-widget)
6. [បន្ថែម Bar Chart](#៦-បន្ថែម-bar-chart)
7. [បន្ថែម Pie Chart ជាមួយ Nested Data](#៧-បន្ថែម-pie-chart-ជាមួយ-nested-data)
8. [បន្ថែម Table](#៨-បន្ថែម-table)
9. [Setup Recipients (Auto)](#៩-setup-recipients-auto)
10. [Preview និង Filter](#១០-preview-និង-filter)
11. [Custom Script — ការណែនាំ](#១១-custom-script--ការណែនាំ)
12. [Custom Script — ឧទាហរណ៍](#១២-custom-script--ឧទាហរណ៍)

---

## ១. ការបង្កើត Report ថ្មី

1. ចូល **Reports** នៅ sidebar ខាងឆ្វេង
2. ចុច **New Report** (ប៊ូតុងខាងស្ដាំ)
3. បំពេញ:
   - **Name**: `CPO Monthly Report`
   - **Page Size**: `A4`
   - **Orientation**: `Portrait`
4. ចុច **Create** → canvas editor នឹងបើ

---

## ២. Canvas Editor — ការណែនាំ

```
┌──────────────┬──────────────────────────┬─────────────────────┐
│ Elements     │        Canvas            │  Properties Panel   │
│ Panel        │   (drag elements here)   │  (configure select) │
│ (ឆ្វេង)       │       (កណ្ដាល)            │      (ស្ដាំ)          │
└──────────────┴──────────────────────────┴─────────────────────┘
```

| ផ្នែក | ការងារ |
|---|---|
| **Elements Panel** (ឆ្វេង) | Drag element ចូល canvas |
| **Canvas** (កណ្ដាល) | ទីកន្លែង design report — drag/resize element |
| **Properties Panel** (ស្ដាំ) | Configure element ដែល select |
| **Bottom bar** | Page nav, Guide, Zoom |

**Top bar buttons:**
| ប៊ូតុង | ន័យ |
|---|---|
| **Preview** | PDF ពេញ (data គ្រប់ rows) |
| **Filter** | PDF filtered ម្នាក់ (ដោយ email) |
| **Save** | រក្សាទុក template |
| **Run** | Generate PDF (មិន send email) |

---

## ៣. Element Types

| Element | ប្រើសម្រាប់ |
|---|---|
| **Heading** | ចំណងជើងធំ (auto-fill ពី API បាន) |
| **Text** | អត្ថបទ / subtitle (auto-fill ពី API បាន) |
| **Divider** | បន្ទាត់បំបែក section |
| **Data Widget** | KPI card, progress circle, sparkline |
| **Chart** | Bar, Line, Pie, Bar-H, Bar+Line |
| **Table** | តារាងទិន្នន័យ ពី API |
| **Progress Bar** | % bar (e.g. profit margin) |
| **Image** | រូបភាព / logo |
| **Page Number** | លេខទំព័រ |

---

## ៤. បន្ថែម Heading ពី API

> **គោលដៅ**: Heading ដែលបង្ហាញ CPO name ដូចជា `Green Energy Cambodia`

**ជំហាន:**
1. Drag **Heading** ចូល canvas
2. ចុចលើ Heading → Properties panel ខាងស្ដាំបើ
3. ផ្នែក **Content**: វាយ `{value0}` *(token ដែល replace ដោយ API data)*
4. Scroll ចុះក្រោម → ចុច **Text Data Source**
5. បំពេញ:

```
URL:          http://localhost:5000/api/cpo
Data Path:    data
Field Key:    cpo_name
Aggregation:  first
Template:     {value0}
```

6. ចុច **Fetch** ដើម្បីសាក → Heading preview នឹងបង្ហាញ CPO name

> **Data Path** = path ទៅ array ក្នុង JSON response
> `data` → `response.data[...]`
> `results.items` → `response.results.items[...]`

---

## ៥. បន្ថែម KPI Widget

> **គោលដៅ**: Card បង្ហាញ `$18,500` Monthly Income

**ជំហាន:**
1. Drag **Data Widget** ចូល canvas
2. Properties → **Widget Mode**: `KPI`
3. **KPI Label**: `Monthly Income`
4. **Number Format**: `currency` | **Symbol**: `$`
5. ចុច **Data Source** tab:

```
URL:          http://localhost:5000/api/cpo
Data Path:    data
Value Key:    finance.monthly_income_usd
Aggregation:  first
Widget Mode:  kpi
```

6. ចុច **Fetch** → preview នឹងបង្ហាញ `$18,500.00`

**ធ្វើបន្ថែម ២ ដង ទៀត:**

| KPI Label | Value Key | Format |
|---|---|---|
| Monthly Expense | `finance.monthly_expense_usd` | currency |
| Monthly Profit | `finance.monthly_profit_usd` | currency |

> **Dot notation**: `finance.monthly_income_usd` = `row.finance.monthly_income_usd` — system ចូល nested object ដោយស្វ័យប្រវត្តិ

---

## ៦. បន្ថែម Bar Chart

> **គោលដៅ**: Grouped bar — Income vs Expense per CPO

**ជំហាន:**
1. Drag **Chart** ចូល canvas → resize ដល់ height ~180px
2. Properties → **Chart Type**: `Bar`
3. ចុច **Data Source** tab:

```
URL:          http://localhost:5000/api/cpo
Data Path:    data
Name Key:     cpo_name
Value Key:    finance.monthly_income_usd
Value 2 Key:  finance.monthly_expense_usd
```

4. **Bar Label**: `Income` | **Bar 2 Label**: `Expense`
5. ចុច **Fetch** → chart preview នឹងបង្ហាញ bars ពីរ per CPO

> **Value 2 Key** = second bar ក្នុង grouped bar chart
> ត្រូវជ្រើស **Chart Type: Bar** (មិនមែន bar-line)

---

## ៧. បន្ថែម Pie Chart ជាមួយ Nested Data

> **គោលដៅ**: Pie chart — income per charger location (filter តែ CPO នោះ)

**ជំហាន:**
1. Drag **Chart** ចូល canvas → height ~260px
2. **Chart Type**: `Pie`
3. **Data Source** tab:

```
URL:             http://localhost:5000/api/cpo
Data Path:       data
Expand Nested:   charger_locations
Name Key:        location_name
Value Expr:      sumProduct(chargers, monthly_energy_kwh, price_per_kwh)
Skip Filter:     ❌ (OFF)
```

4. ចុច **Fetch**

**ការពន្យល់ Value Expr:**

| Expression | ន័យ |
|---|---|
| `sumProduct(chargers, monthly_energy_kwh, price_per_kwh)` | `Σ(monthly_energy_kwh × price_per_kwh)` per charger |
| `sum(chargers, total_sessions)` | `Σ(total_sessions)` per charger |

> **Expand Nested** = unfold nested array ចេញពី parent row
> Filter ទៅ CPO email មុន ហើយ expand `charger_locations` របស់ CPO នោះ

**Skip Filter:**
- `OFF` = filter ត្រឹម CPO ម្នាក់ (per-recipient chart)
- `ON` = show ទាំងអស់ (global comparison)

---

## ៨. បន្ថែម Table

> **គោលដៅ**: តារាង — Company, Stations, Income, Profit, Status

**ជំហាន:**
1. Drag **Table** ចូល canvas → height ~200px
2. **Data Source** tab:

```
URL:        http://localhost:5000/api/cpo
Data Path:  data
```

3. **Column Definitions** → ចុច **Add Column** ១ ដងក្នុង​ ១ column:

| Field Key | Label |
|---|---|
| `cpo_name` | Company |
| `total_stations` | Stations |
| `total_chargers` | Chargers |
| `finance.monthly_income_usd` | Income (USD) |
| `finance.monthly_profit_usd` | Profit (USD) |
| `status` | Status |

4. ចុច **Fetch** → table preview show up

---

## ៩. Setup Recipients (Auto)

> ប្រព័ន្ធ extract emails ពី API ហើយ generate PDF ១ ច្បាប់ per recipient

**ជំហាន:**
1. ចុច **Guide** button (bottom bar) → Setup Guide Drawer បើ
2. ចុច **Step 3 — Recipients**
3. Enable **Auto-recipients from API data** (toggle ON)
4. បំពេញ:

```
Source URL:   http://localhost:5000/api/cpo
Data Path:    data
Email Field:  email
```

5. ចុច **Save** → system រៀបចំខ្លួន

**ដំណើរការ Auto-recipients:**
```
API data → extract email[] → generate PDF per email → filter data per email → send
```

| Recipient | Data ដែលឃើញ |
|---|---|
| support@greenenergy.com | Green Energy Cambodia only |
| contact@evpowerasia.com | EV Power Asia only |
| info@chargekh.com | ChargeKH only |

---

## ១០. Preview និង Filter

**Full Preview** (ប៊ូតុង Preview):
- PDF ពេញ — data គ្រប់ rows (unfiltered)
- ល្អ​ សម្រាប់ check layout

**Filter Preview** (ប៊ូតុង Filter):
- Preview ដូច​ recipient ម្នាក់ឃើញ
- បំពេញ:
  - **Filter Field**: `email`
  - **Value**: `support@greenenergy.com`
- ចុច **Preview filtered PDF**

> Filter field/value ត្រូវបាន save ក្នុង localStorage — មិនបាច់វាយ​ ម្ដងទៀតនៅ session ក្រោយ

---

## ១១. Custom Script — ការណែនាំ

Custom Script គឺ JavaScript code ដែល run ក្នុង browser ហើយ **override** content ដែល element បង្ហាញ។

**ប្រើបាននៅ element types:**
- Text
- Heading
- Data Widget (KPI)

**ការ enable:**
1. ចុចលើ element
2. Properties panel → scroll ចុះ → **Custom Script** section
3. Toggle **Enable script** → ON
4. វាយ JavaScript ក្នុង textarea
5. ចុច ▶ **Test** ដើម្បីមើល output

**Variables ដែលប្រើបាន:**

| Variable | Type | ន័យ |
|---|---|---|
| `value` | `any` | current content / KPI value ក្នុង element |
| `data` | `object\|null` | data source config (url, field, ...) |
| `rows` | `array` | rows ទាំងអស់ពី API (filtered) |
| `id` | `string` | element ID |
| `type` | `string` | element type (`text`, `heading`, `data-widget`) |
| `props` | `object` | props ទាំងអស់របស់ element |

**Rules:**
- Script ត្រូវ `return` string → ត្រូវបាន display
- `return null` ឬ `return undefined` → ប្រើ default display (ពី API/content)
- Error → បង្ហាញ `[Script Error: ...]`

---

## ១២. Custom Script — ឧទាហរណ៍

### ឧទាហរណ៍ ១ — Format KPI value

> **គោលដៅ**: $18500 → `🟢 $18,500 / month`

```javascript
// value = KPI value ដែល API return
if (value === null) return null;
const num = parseFloat(value);
if (isNaN(num)) return value;
const fmt = '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2 });
return '🟢 ' + fmt + ' / month';
```

---

### ឧទាហរណ៍ ២ — Status badge ជាភាសាខ្មែរ

> **គោលដៅ**: Text element showing CPO status → "🟢 សកម្ម" / "🔴 ឈប់ប្រើ"

```javascript
// value = status string ពី API e.g. "active", "inactive", "maintenance"
const statusMap = {
  active:      '🟢 សកម្ម',
  inactive:    '🔴 ឈប់ប្រើ',
  maintenance: '🟡 កំពុងជួសជុល',
};
return statusMap[value] || value;
```

---

### ឧទាហរណ៍ ៣ — គណនា Profit Margin %

> **គោលដៅ**: Data Widget — show profit margin % ពី rows

```javascript
// rows = filtered rows សម្រាប់ CPO នោះ
if (!rows || rows.length === 0) return '0%';
const row = rows[0];
const income  = parseFloat(row?.finance?.monthly_income_usd)  || 0;
const profit  = parseFloat(row?.finance?.monthly_profit_usd)  || 0;
if (income === 0) return '0%';
const pct = ((profit / income) * 100).toFixed(1);
return pct + '%';
```

---

### ឧទាហរណ៍ ៤ — Conditional color text

> **គោលដៅ**: Profit positive → បង្ហាញ "▲ Profit", negative → "▼ Loss"

```javascript
const num = parseFloat(value);
if (isNaN(num)) return value;
if (num > 0) return '▲ $' + num.toLocaleString('en-US', { minimumFractionDigits: 2 });
if (num < 0) return '▼ $' + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' (Loss)';
return 'Break even';
```

---

### ឧទាហរណ៍ ៥ — Summary text ពី rows ច្រើន

> **គោលដៅ**: Heading element — `CPO001 · 5 Stations · 18 Chargers`

```javascript
if (!rows || rows.length === 0) return null;
const r = rows[0];
const name      = r?.cpo_name     || 'Unknown';
const stations  = r?.total_stations || 0;
const chargers  = r?.total_chargers || 0;
return name + ' · ' + stations + ' Stations · ' + chargers + ' Chargers';
```

---

### ឧទាហរណ៍ ៦ — ប្រើ props ដើម្បី logic ខុសគ្នា per element

```javascript
// props = object ដែលមាន config ទាំងអស់ (kpiLabel, numberFormat, ...)
if (props.kpiLabel === 'Monthly Profit') {
  const num = parseFloat(value);
  return num >= 0 ? '✅ Profitable: $' + num.toFixed(2) : '❌ Loss: $' + num.toFixed(2);
}
return null; // ប្រើ default display សម្រាប់ elements ផ្សេង
```

---

## ជំហានសង្ខេប (Quick Reference)

```
New Report
  └─ Add Heading       → Text Data Source (cpo_name, first)
  └─ Add 3x KPI        → Widget Data Source (finance.*, first, currency)
  └─ Add Bar Chart     → Data Source (nameKey=cpo_name, valueKey=income, value2Key=expense)
  └─ Add Pie Chart     → Data Source (expandNested=charger_locations, valueExpr=sumProduct(...))
  └─ Add Table         → Data Source (columnDefs=[...])
  └─ Guide → Step 3    → Auto-recipients (emailField=email)
  └─ Filter Preview    → filterField=email, value=support@greenenergy.com
  └─ Save → Run
```

---

## Aggregation Types (Reference)

| Type | ន័យ | ប្រើ |
|---|---|---|
| `first` | value ពី row ដំបូង | ប្រើ KPI / text per-recipient |
| `last` | value ពី row ចុងក្រោយ | — |
| `sum` | Σ values ទាំងអស់ | total count |
| `avg` | average | mean value |
| `min` | minimum | lowest value |
| `max` | maximum | highest value |
| `count` | ចំនួន rows | number of records |

## Value Expressions (Reference)

| Expression | ន័យ |
|---|---|
| `sumProduct(arr, k1, k2)` | `Σ(row[k1] × row[k2])` ក្នុង nested array |
| `sum(arr, key)` | `Σ(row[key])` ក្នុង nested array |
| field path (e.g. `finance.profit`) | direct nested value |

---

*ឯកសារនេះ generate ដោយ Claude Code — Prism Report Module*
