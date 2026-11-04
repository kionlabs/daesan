# Supabase Storage 및 RLS(Row Level Security) 설정 가이드 (daesan 커스텀 스키마 적용)

이 문서는 프로젝트 1단계의 Supabase 커스텀 스키마(`daesan`) 활성화 설정, Storage 버킷 생성 및 민감 데이터 보호를 위한 RLS 정책 구성 방법을 설명합니다.

---

## 0. Supabase 대시보드 커스텀 스키마 활성화

기본 `public` 스키마가 아닌 커스텀 스키마 `daesan`에 있는 테이블들을 API로 접근하기 위해서는 Supabase 대시보드에서 스키마를 노출시켜야 합니다.

### 설정 단계
1. **Supabase 대시보드**에 접속하여 프로젝트를 선택합니다.
2. 좌측 네비게이션 하단의 **Project Settings** (톱니바퀴 아이콘) > **API** 메뉴로 이동합니다.
3. **Exposed schemas** 항목을 찾습니다.
4. 기존 `public` 외에 **`daesan`** 스키마를 추가로 입력/선택합니다.
5. 변경 사항을 저장합니다.
   - *이 설정을 거쳐야만 프런트엔드에서 `db: { schema: 'daesan' }` 옵션을 사용해 테이블을 조회할 때 `406 Not Acceptable` 혹은 `schema "daesan" does not exist` 등의 API 에러가 발생하지 않습니다.*

---

## 1. Supabase Storage 설정 (`media-bucket`)

직원들의 활동 증빙 동영상 및 마트의 현장 사진/영상을 저장하기 위한 `media-bucket`을 생성하는 방법입니다.

### 버킷 생성 단계
1. **Supabase 대시보드**의 좌측 네비게이션 바에서 **Storage** 메뉴로 이동합니다.
2. **New bucket** 버튼을 클릭합니다.
3. 버킷 이름을 `media-bucket`으로 입력합니다.
4. **Public bucket** 옵션을 활성화합니다. (보안이 극도로 요구되는 개인 정보가 아니라 대외용 동영상/사진이므로, 서비스에서 직접 URL을 참조하기 편하도록 Public으로 설정하는 것이 권장됩니다.)
   - *만약 완전 비공개 파일로 처리하고자 한다면 Private으로 설정하고, 클라이언트에서 Supabase SDK의 `createSignedUrl` API를 통해 한시적 접근 권한이 있는 URL을 발급받아야 합니다.*
5. **Save**를 눌러 버킷을 생성합니다.

---

## 2. Row Level Security (RLS) 및 민감 정보 보호 설정

`daesan.staffs.admin_notes` 및 `daesan.markets.owner_notes`는 일반 직원이나 외부 사용자에게 노출되어서는 안 되는 **관리자 전용 메모**입니다.
PostgreSQL의 RLS는 기본적으로 **행(Row) 단위** 보안을 지원하므로, **열(Column) 단위**의 민감 정보를 제어하기 위해서는 다음 두 가지 방법 중 하나를 선택하여 구성해야 합니다.

### [추천] 방법 A: 민감 메모 테이블을 별도로 분리하여 RLS 적용
민감한 정보를 별도의 테이블로 분리하면 Supabase의 자동 생성 API(PostgREST)를 사용할 때 가장 안전하고 깔끔하게 권한 관리를 할 수 있습니다.

#### 1) 스키마 변경 (메모 테이블 분리)
```sql
-- 기존 daesan.staffs 테이블에서 admin_notes 제거 후 아래 테이블 생성
CREATE TABLE daesan.staff_admin_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID UNIQUE NOT NULL REFERENCES daesan.staffs(id) ON DELETE CASCADE,
    admin_notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 기존 daesan.markets 테이블에서 owner_notes 제거 후 아래 테이블 생성
CREATE TABLE daesan.market_owner_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID UNIQUE NOT NULL REFERENCES daesan.markets(id) ON DELETE CASCADE,
    owner_notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 2) RLS 활성화 및 관리자만 조회 가능한 정책 적용
```sql
-- RLS 활성화
ALTER TABLE daesan.staff_admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE daesan.market_owner_notes ENABLE ROW LEVEL SECURITY;

-- 관리자(Admin) 권한을 가진 인증된 사용자만 조회/생성/수정/삭제 가능하도록 설정
CREATE POLICY "Allow admin access to staff notes" ON daesan.staff_admin_notes
    FOR ALL
    TO authenticated
    USING ( (select private.is_admin()) )
    WITH CHECK ( (select private.is_admin()) );

CREATE POLICY "Allow admin access to market notes" ON daesan.market_owner_notes
    FOR ALL
    TO authenticated
    USING ( (select private.is_admin()) )
    WITH CHECK ( (select private.is_admin()) );
```

---

### 방법 B: 단일 테이블 내에서 관리자(Admin) 전용 RLS 설정
테이블을 분리하지 않고 단일 테이블을 유지한 상태에서, 비관리자는 아예 해당 행(Row) 자체를 조회할 수 없도록 제한하는 방법입니다. (일반 직원이 자기 자신의 프로필만 조회 가능하고, 관리자는 모든 프로필 및 메모를 조회 가능한 시나리오에 적합합니다.)

#### RLS 정책 적용 예시 SQL
```sql
-- 1. 테이블 RLS 활성화
ALTER TABLE daesan.staffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daesan.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE daesan.schedules ENABLE ROW LEVEL SECURITY;

-- 2. Staffs 테이블 정책 설정
-- 가) 관리자는 모든 직원의 정보를 조회하고 편집할 수 있습니다.
CREATE POLICY "Admins can do everything on staffs" ON daesan.staffs
    FOR ALL
    TO authenticated
    USING ( (select private.is_admin()) )
    WITH CHECK ( (select private.is_admin()) );

-- 나) 일반 직원은 자기 자신의 프로필 정보만 조회할 수 있고, admin_notes는 보이지 않도록 클라이언트에서 요청 시 필터링해야 합니다.
-- (주의: 행 단위 RLS이므로 행 자체가 반환되면 admin_notes 컬럼 값도 함께 노출됩니다.)
CREATE POLICY "Staffs can view their own profile" ON daesan.staffs
    FOR SELECT
    TO authenticated
    USING ( auth.uid() = id );
```

> [!WARNING]
> **단일 테이블 유지 시 컬럼 노출 주의사항**
> 방법 B와 같이 단일 테이블을 사용할 경우, 일반 직원이 본인 프로필 조회 권한을 획득하면 `admin_notes` 컬럼 데이터까지 함께 조회할 수 있게 됩니다. 따라서 완전한 컬럼 레벨 보안을 유지하려면 **방법 A(테이블 분리)**를 적용하거나, 일반 사용자용 API 요청 시 `select('id, name, contact, video_url')`과 같이 특정 컬럼만 명시적으로 조회하도록 제한하고, 데이터베이스 단에서 보안 뷰(Secure View)를 생성하여 접근 권한을 제한하는 것이 안전합니다.

---

## 3. Supabase Realtime(실시간 동기화) 활성화

실시간 스케줄러 기능이 새로고침 없이 다른 브라우저 세션과 연동되기 위해선 Supabase Database의 Realtime 복제(Replication) 기능을 `daesan.schedules` 테이블에 대해 활성화해야 합니다.

### 설정 방법
1. **Supabase 대시보드**에 로그인합니다.
2. 좌측 네비게이션 메뉴 중 **Database** (데이터베이스 실물 아이콘) 메뉴로 들어갑니다.
3. 데이터베이스 설정 내 **Replication** 메뉴를 클릭합니다.
4. **supabase_realtime** 복제 소스가 보이면 편집 또는 활성화 상태를 확인하고, 감시 대상 테이블 목록에 **`daesan.schedules`** 테이블을 토글하여 켭니다.
   - *또는 SQL Editor에서 아래의 쿼리를 실행하여 직접 활성화할 수도 있습니다.*

```sql
-- daesan.schedules 테이블에 대한 실시간 복제(Realtime) 강제 활성화 SQL
alter publication supabase_realtime add table daesan.schedules;

-- daesan.schedules 테이블 기간(Period) 단위 스키마 개편 SQL
ALTER TABLE daesan.schedules ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE daesan.schedules ADD COLUMN IF NOT EXISTS end_date DATE;
UPDATE daesan.schedules SET start_date = schedule_date, end_date = schedule_date WHERE start_date IS NULL;
```
5. 설정이 완료되면, 한 브라우저 창에서 직원을 배정할 때 다른 창의 스케줄판도 즉각적으로 실시간 동기화가 이뤄집니다.

---

## 4. 52주 매출 관리 테이블 (`daesan.revenues`) 설정

직원별 52주 매출 데이터 저장 및 정산을 위해 Supabase SQL Editor에서 아래 쿼리를 실행해 테이블을 생성합니다.

```sql
CREATE TABLE IF NOT EXISTS daesan.revenues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES daesan.staffs(id) ON DELETE CASCADE,
    market_id UUID REFERENCES daesan.markets(id) ON DELETE SET NULL,
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 53),
    period_text TEXT,
    revenue_amount INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_staff_year_week UNIQUE (staff_id, year, week_number)
);

-- RLS 활성화 및 접근 권한 설정
ALTER TABLE daesan.revenues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read revenues" ON daesan.revenues
    FOR SELECT
    TO authenticated
    USING ( (select private.is_admin()) );

CREATE POLICY "Admins can write revenues" ON daesan.revenues
    FOR ALL
    TO authenticated
    USING ( (select private.is_admin()) )
    WITH CHECK ( (select private.is_admin()) );
```
