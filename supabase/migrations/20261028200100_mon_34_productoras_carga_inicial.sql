-- Carga inicial de productoras con los accesos existentes (validada por Diego el 28/10/2026).
-- Los integrantes ya tenían acceso: se dan por avisados (sin correo de acceso).
-- Darío Regueiro (Defensa Civil de Vicente López) queda como acceso adicional de JPM Challenge 2026.
-- Bomberos de Chacabuco queda sin productora y conserva sus accesos.

insert into public.mon_productoras (nombre, creado_por) values
  ('Sportsfacilities', 'dpizzini@emerteam.com.ar'),
  ('Club de Corredores', 'dpizzini@emerteam.com.ar')
on conflict (nombre) do nothing;

-- Integrantes, con nombre y apellido tomados de sus accesos actuales
insert into public.mon_productora_miembros (productora_id, email, nombre, apellido, rol, responsable, recibe_alertas, habilitado_por, aviso_alta_en)
select p.id, a.email, a.nombre, a.apellido, a.rol, x.responsable, a.recibe_alertas, 'dpizzini@emerteam.com.ar', now()
from (values
  ('Sportsfacilities', 'romisportsfacilities@gmail.com', true),
  ('Sportsfacilities', 'rodygiordano@gmail.com', false),
  ('Sportsfacilities', 'lanzavecchiacarlos@gmail.com', false),
  ('Club de Corredores', 'ssantamarina@clubdecorredores.com', true)
) as x(productora, email, responsable)
join public.mon_productoras p on p.nombre = x.productora
join lateral (select * from public.mon_accesos a where a.email = x.email order by a.creado_en desc limit 1) a on true
on conflict (productora_id, email) do nothing;

-- Eventos de cada productora
update public.mon_eventos e set productora_id = p.id
from public.mon_productoras p
where (p.nombre = 'Sportsfacilities' and e.nombre in ('Halloween Run', 'Media Maratón de Mar del Plata'))
   or (p.nombre = 'Club de Corredores' and e.nombre in ('JPM Challenge 2026', 'Carrera Mc Donalds', 'Carrera Axion'));

-- Accesos por evento que el grupo ya cubre
delete from public.mon_accesos a
using public.mon_eventos e, public.mon_productora_miembros m
where a.evento_id = e.id and m.productora_id = e.productora_id and m.email = a.email;

update public.mon_accesos set rol = 'Defensa Civil Vicente López'
where email = 'darioregueiro1979@gmail.com' and rol is null;
