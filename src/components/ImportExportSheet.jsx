import { useEffect, useState } from 'react'
import ExportTab from './importExport/ExportTab'
import SubscribeTab from './importExport/SubscribeTab'
import ImportICSTab from './importExport/ImportICSTab'
import TextTab from './importExport/TextTab'
import PhotoTab from './importExport/PhotoTab'

// Cáscara del sheet Import/Export. Cada tab vive en su propio archivo en
// src/components/importExport/*.jsx — este archivo solo tiene la UI de
// contenedor (backdrop, header, tab bar, mount del tab activo).
const TABS = [
  { id: 'export',    label: 'Exportar',    icon: 'ios_share' },
  { id: 'subscribe', label: 'Suscripción', icon: 'rss_feed' },
  { id: 'import',    label: 'Importar',    icon: 'download' },
  { id: 'text',      label: 'Por texto',   icon: 'edit_note' },
  { id: 'photo',     label: 'Foto',        icon: 'photo_camera' },
]

export default function ImportExportSheet({
  isOpen,
  onClose,
  events,
  onImportEvent,
  initialTab = 'export',
}) {
  const [activeTab, setActiveTab] = useState(initialTab)

  // Reset al tab inicial cada vez que el sheet se abre.
  useEffect(() => { if (isOpen) setActiveTab(initialTab) }, [isOpen, initialTab])

  // Cerrar con Escape (antes no existía).
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-export-title"
        className="fixed bottom-0 left-0 right-0 z-[56] max-h-[90dvh] flex flex-col bg-surface dark:bg-slate-900 rounded-t-[28px] shadow-2xl"
        style={{ animation: 'slideUp 0.3s cubic-bezier(0.34,1.2,0.64,1) both' }}
      >
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mt-4 mb-2 flex-shrink-0" aria-hidden="true" />

        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
          <h2 id="import-export-title" className="font-headline font-extrabold text-xl text-on-surface dark:text-slate-100">
            Importar / Exportar
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-8 h-8 flex items-center justify-center rounded-full text-outline hover:bg-surface-container-low transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div role="tablist" aria-label="Secciones" className="flex gap-1.5 px-6 pb-3 flex-shrink-0 overflow-x-auto hide-scrollbar">
          {TABS.map(({ id, label, icon }) => {
            const selected = activeTab === id
            return (
              <button
                key={id}
                role="tab"
                aria-selected={selected}
                aria-controls={`tabpanel-${id}`}
                id={`tab-${id}`}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                  selected
                    ? 'bg-primary text-white shadow-md shadow-primary/20'
                    : 'bg-surface-container-low text-outline hover:text-on-surface'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{icon}</span>
                {label}
              </button>
            )
          })}
        </div>

        <div
          id={`tabpanel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="flex-1 overflow-y-auto hide-scrollbar px-6 pb-10"
        >
          {activeTab === 'export'    && <ExportTab events={events} />}
          {activeTab === 'subscribe' && <SubscribeTab />}
          {activeTab === 'import'    && <ImportICSTab onImport={onImportEvent} />}
          {activeTab === 'text'      && <TextTab onImport={onImportEvent} />}
          {activeTab === 'photo'     && <PhotoTab onImport={onImportEvent} />}
        </div>
      </div>
    </>
  )
}
