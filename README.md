# ERYLA METYLA · Evaluación de capacitaciones

Aplicación responsive para cursos organizados en encuentros. Cada encuentro tiene un Ticket de Entrada y otro de Salida; el administrador decide cuál queda habilitado en cada momento.

## Funciones

- cursos de 1 a 12 encuentros;
- tres preguntas técnicas editables por encuentro, repetidas en Entrada y Salida;
- pregunta integradora comparada entre Entrada 1 y la Salida del último encuentro;
- registro inicial de nombre y apellido, correo, DNI, institución, área de trabajo y fecha;
- vinculación de todos los tickets al mismo participante mediante correo;
- expectativa inicial, clasificación temática y cumplimiento final;
- informe por encuentro con respuestas correctas, cambio y participantes que mejoraron, se mantuvieron o disminuyeron;
- evolución integradora del inicio al cierre;
- distribución por institución y área de trabajo;
- CSV individual completo con fechas y respuestas;
- cierre, reapertura y borrado confirmado de los datos del curso;
- panel protegido con Supabase Auth y políticas RLS;
- estética oficial ERYLA METYLA, sin dependencias de la instalación anterior.

## Instalación nueva

1. Crear un proyecto vacío en Supabase desde la cuenta `eryla.metyla@gmail.com` de ERYLA METYLA.
2. Ejecutar `supabase.sql` completo en el SQL Editor.
3. En Authentication > Users, crear el usuario técnico indicado en `config.js`, con una clave compartida de al menos 6 caracteres y Auto confirm user habilitado.
4. Copiar el UUID del usuario y ejecutar:

   ```sql
   insert into public.admin_profiles (user_id) values ('UUID-DEL-USUARIO');
   ```

5. Completar en `config.js` la URL del proyecto y su clave pública `anon`.
6. Publicar el repositorio en GitHub Pages.

La clave `anon` es pública por diseño. Nunca debe copiarse la clave `service_role` al sitio. La protección real de participantes, DNI y respuestas está en las políticas RLS de `supabase.sql`.

## Privacidad

Esta versión guarda datos personales. Los participantes pueden completar tickets sin cuenta, pero no pueden leer datos. Solo el usuario administrador autorizado puede acceder, exportar o borrar participantes y respuestas. La página de administración no debe quedar protegida por una contraseña incrustada en JavaScript.

## Prueba local

Sin credenciales en `config.js`, funciona en modo demostración y guarda datos solo en el navegador. Para ejecutar las pruebas:

```powershell
npm test
```

Para visualizar el sitio localmente:

```powershell
python -m http.server 8765
```
