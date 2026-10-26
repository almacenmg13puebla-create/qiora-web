'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const fmt = n => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(n||0))
const fecha = s => s ? new Intl.DateTimeFormat('es-MX',{dateStyle:'short',timeStyle:'short',timeZone:'America/Mexico_City'}).format(new Date(s)) : '-'

export default function BajasCobros() {
  const router = useRouter()
  const [perfil,setPerfil] = useState(null)
  const [tipo,setTipo] = useState('BAJAS')
  const [mes,setMes] = useState('')
  const [almacen,setAlmacen] = useState('')
  const [filas,setFilas] = useState([])
  const [cargando,setCargando] = useState(false)
  const [error,setError] = useState('')
  const [iniciando,setIniciando] = useState(true)

  useEffect(()=>{
    let montado=true
    ;(async()=>{
      try {
        const {data:{user}}=await supabase.auth.getUser()
        if(!user) {router.replace('/');return}
        const {data,error}=await supabase.rpc('qiora_mi_perfil')
        if(error) throw error
        if(!data?.activo || !(data.auditoria || data.ver_auditorias || data.administrar_permisos))
          throw new Error('No tienes permisos para consultar Bajas y Cobros.')
        if(montado) setPerfil(data)
      } catch(e) { if(montado) setError(e.message||'No fue posible validar acceso') }
      finally { if(montado) setIniciando(false) }
    })()
    return ()=>{montado=false}
  },[router])

  async function buscar() {
    if(!perfil || cargando) return
    setCargando(true);setError('')
    try {
      const {data,error:e}=await supabase.rpc('qiora_consultar_movimientos',{
        p_tipo:tipo,p_mes:mes,p_almacen:almacen.trim().padStart(4,'0') .replace(/^0000$/,'')
      })
      if(e) throw e
      setFilas(Array.isArray(data)?data:[])
    } catch(e) {setError(e.message||'No fue posible consultar');setFilas([])}
    finally {setCargando(false)}
  }
  const btn={border:0,borderRadius:8,padding:'10px 16px',background:'#087657',color:'white',fontWeight:700,cursor:'pointer'}
  const inp={padding:10,borderRadius:8,border:'1px solid #b7ccc3',background:'white',color:'#17211d'}
  return <main style={{minHeight:'100vh',background:'#063126',padding:18,fontFamily:'Arial,sans-serif'}}>
    <div style={{maxWidth:1250,margin:'auto'}}>
      <button style={btn} onClick={()=>router.push('/')}>← Panel principal</button>
      <section style={{background:'#fff',padding:22,borderRadius:14,marginTop:16}}>
        <h1 style={{color:'#07573e'}}>Consulta de Bajas y Cobros</h1>
        <p>Distrito: <strong>{perfil?.distrito||'-'}</strong>. Registros enviados desde Auditorías; filtrados por fecha de emisión.</p>
        {error && <p role="alert" style={{color:'#b22222',fontWeight:700}}>{error}</p>}
        {iniciando ? <p>Validando acceso...</p> : perfil && <>
          <div style={{display:'flex',flexWrap:'wrap',gap:14,alignItems:'end'}}>
            <label style={{display:'grid',gap:6}}>Hoja<select style={inp} value={tipo} onChange={e=>{setTipo(e.target.value);setFilas([])}}><option value="BAJAS">BAJAS</option><option value="COBROS">COBROS</option></select></label>
            <label style={{display:'grid',gap:6}}>Mes<input style={inp} type="month" value={mes} onChange={e=>setMes(e.target.value)}/></label>
            <label style={{display:'grid',gap:6}}>Almacén<input style={inp} placeholder="Todos" value={almacen} onChange={e=>setAlmacen(e.target.value)}/></label>
            <button disabled={cargando} style={btn} onClick={buscar}>{cargando?'Buscando...':'Buscar'}</button>
            <button style={{...btn,background:'#52655c'}} onClick={()=>{setMes('');setAlmacen('');setFilas([])}}>Limpiar filtros</button>
          </div>
          <h2>{tipo} ({filas.length})</h2>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:650}}>
            <thead><tr>{['ID','Folio auditoría','Almacén','Fecha de envío','Estado','Importe'].map(h=><th key={h} style={{padding:11,background:'#e0eee7',textAlign:'left'}}>{h}</th>)}</tr></thead>
            <tbody>{filas.map(x=><tr key={x.id}><td style={{padding:10,borderBottom:'1px solid #ddd'}}>{x.id}</td><td>{x.folio}</td><td>{x.almacen}</td><td>{fecha(x.creado_en)}</td><td>{x.estado}</td><td>{fmt(x.total)}</td></tr>)}</tbody>
          </table></div>
          {!filas.length && <p>No hay registros para mostrar. Selecciona filtros y presiona Buscar.</p>}
        </>}
      </section>
    </div>
  </main>
}
