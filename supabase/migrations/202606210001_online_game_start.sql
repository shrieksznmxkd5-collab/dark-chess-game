begin;

alter table if exists public.rooms enable row level security;
alter table if exists public.room_members enable row level security;
alter table if exists public.game_states_private enable row level security;
alter table if exists public.game_snapshots_public enable row level security;

create unique index if not exists game_states_private_room_id_uidx
  on public.game_states_private (room_id);

create unique index if not exists game_snapshots_public_room_id_uidx
  on public.game_snapshots_public (room_id);

create index if not exists game_snapshots_public_room_version_idx
  on public.game_snapshots_public (room_id, version);

create or replace function public.current_user_is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = p_room_id
      and rm.user_id = auth.uid()
  );
$$;

drop function if exists public.commit_online_game_start(uuid, jsonb, jsonb);
create function public.commit_online_game_start(
  p_room_id uuid,
  p_private_state jsonb,
  p_public_snapshot jsonb
)
returns table (
  room_id uuid,
  status text,
  version integer,
  current_turn text,
  snapshot jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_red_ready boolean := false;
  v_black_ready boolean := false;
  v_existing_snapshot public.game_snapshots_public%rowtype;
  v_leaked_piece jsonb;
begin
  if v_user_id is null then
    raise exception '需要先完成匿名登录。' using errcode = 'P0001';
  end if;

  if p_room_id is null then
    raise exception '缺少房间 ID。' using errcode = 'P0001';
  end if;

  if p_private_state is null or jsonb_typeof(p_private_state) <> 'object' then
    raise exception '私有棋局状态无效。' using errcode = 'P0001';
  end if;

  if p_public_snapshot is null or jsonb_typeof(p_public_snapshot) <> 'object' then
    raise exception '公开棋局快照无效。' using errcode = 'P0001';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception '房间不存在。' using errcode = 'P0001';
  end if;

  if not public.current_user_is_room_member(p_room_id) then
    raise exception '只有房间成员可以初始化在线棋局。' using errcode = '42501';
  end if;

  if v_room.status = 'playing' then
    select *
    into v_existing_snapshot
    from public.game_snapshots_public gsp
    where gsp.room_id = p_room_id;

    if not found then
      raise exception '房间已开始，但公开快照不存在。' using errcode = 'P0001';
    end if;

    return query
    select
      v_room.id,
      v_room.status::text,
      v_existing_snapshot.version,
      v_existing_snapshot.current_turn::text,
      v_existing_snapshot.snapshot;
    return;
  end if;

  if v_room.status <> 'waiting' then
    raise exception '房间当前状态不能开始棋局。' using errcode = 'P0001';
  end if;

  select coalesce(bool_or(camp = 'red' and ready), false)
  into v_red_ready
  from public.room_members
  where room_id = p_room_id;

  select coalesce(bool_or(camp = 'black' and ready), false)
  into v_black_ready
  from public.room_members
  where room_id = p_room_id;

  if not v_red_ready or not v_black_ready then
    raise exception '红黑双方都准备后才能开始。' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.room_members rm
    where rm.room_id = p_room_id
      and rm.camp = 'red'
      and rm.user_id = v_room.red_user_id
  ) then
    raise exception '红方玩家信息不完整。' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.room_members rm
    where rm.room_id = p_room_id
      and rm.camp = 'black'
      and rm.user_id = v_room.black_user_id
  ) then
    raise exception '黑方玩家信息不完整。' using errcode = 'P0001';
  end if;

  if coalesce((p_public_snapshot ->> 'currentCamp'), '') <> 'red' then
    raise exception '初始公开快照必须由红方先行。' using errcode = 'P0001';
  end if;

  if coalesce((p_public_snapshot ->> 'version')::integer, 0) <> 1 then
    raise exception '初始公开快照版本必须为 1。' using errcode = 'P0001';
  end if;

  select piece
  into v_leaked_piece
  from jsonb_array_elements(coalesce(p_public_snapshot -> 'pieces', '[]'::jsonb)) as piece
  where coalesce((piece ->> 'faceUp')::boolean, false) = false
    and (
      (piece ? 'realType' and piece -> 'realType' <> 'null'::jsonb)
      or
      (piece ? 'realCamp' and piece -> 'realCamp' <> 'null'::jsonb)
    )
  limit 1;

  if found then
    raise exception '公开快照不能包含未翻面棋子的真实身份。' using errcode = 'P0001';
  end if;

  insert into public.game_states_private (
    room_id,
    state,
    version,
    created_at,
    updated_at
  )
  values (
    p_room_id,
    p_private_state,
    1,
    now(),
    now()
  )
  on conflict (room_id) do nothing;

  if not found then
    select *
    into v_existing_snapshot
    from public.game_snapshots_public gsp
    where gsp.room_id = p_room_id;

    if found then
      update public.rooms
      set
        status = 'playing',
        current_turn = 'red',
        version = greatest(coalesce(version, 0), 1)
      where id = p_room_id
      returning * into v_room;

      return query
      select
        v_room.id,
        v_room.status::text,
        v_existing_snapshot.version,
        v_existing_snapshot.current_turn::text,
        v_existing_snapshot.snapshot;
      return;
    end if;

    raise exception '棋局已经初始化，但公开快照不存在。' using errcode = 'P0001';
  end if;

  insert into public.game_snapshots_public (
    room_id,
    snapshot,
    version,
    current_turn,
    created_at,
    updated_at
  )
  values (
    p_room_id,
    p_public_snapshot,
    1,
    'red',
    now(),
    now()
  )
  on conflict (room_id) do update set
    snapshot = excluded.snapshot,
    version = excluded.version,
    current_turn = excluded.current_turn,
    updated_at = now();

  update public.rooms
  set
    status = 'playing',
    current_turn = 'red',
    version = 1
  where id = p_room_id
  returning * into v_room;

  select *
  into v_existing_snapshot
  from public.game_snapshots_public gsp
  where gsp.room_id = p_room_id;

  return query
  select
    v_room.id,
    v_room.status::text,
    v_existing_snapshot.version,
    v_existing_snapshot.current_turn::text,
    v_existing_snapshot.snapshot;
end;
$$;

drop policy if exists game_snapshots_public_select_member on public.game_snapshots_public;
create policy game_snapshots_public_select_member
on public.game_snapshots_public
for select
to authenticated
using (
  public.current_user_is_room_member(room_id)
);

revoke all on public.game_states_private from anon, authenticated;

grant select on public.game_snapshots_public to authenticated;
revoke insert, update, delete on public.game_snapshots_public from anon, authenticated;

revoke all on function public.current_user_is_room_member(uuid) from public, anon;
grant execute on function public.current_user_is_room_member(uuid) to authenticated;

revoke all on function public.commit_online_game_start(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.commit_online_game_start(uuid, jsonb, jsonb) to authenticated;

commit;
