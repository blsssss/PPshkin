select d.id as deal_id,
  d.quantity_total,
  d.quantity_left,
  d.quantity_total - d.quantity_left as handed_out,
  count(b.id) filter (where b.status = 'active') as active,
  count(b.id) filter (where b.status = 'redeemed') as redeemed,
  count(b.id) filter (where b.status = 'cancelled') as cancelled
from deals d
left join bookings b on b.deal_id = d.id
group by d.id
order by d.id;

do $$
declare
  broken integer;
begin
  select count(*) into broken
  from deals d
  where d.quantity_left < 0
    or d.quantity_total - d.quantity_left <> (
      select count(*) from bookings b where b.deal_id = d.id and b.status in ('active', 'redeemed')
    );
  if broken > 0 then
    raise exception 'overselling check failed: % deals do not match their bookings', broken;
  end if;
  raise notice 'overselling check passed: every deal hands out exactly as many portions as it has bookings';
end
$$;
