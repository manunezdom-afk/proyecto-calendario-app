const AVATAR_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDUlymkNXhOUvo1PKHacfy4WjdjqZyhU-F--HCZ60_x6tzwkRFkOBrFiEee8AQSbtMtmF8qfqKc69ukd1toshdgeBFJQ6o1V6yQC9l8FQblJ3rUyjwuVlxVEewKyOC_EcuWJmDBOMDb-Nhq5a0yubluKIlyH72I-r0EXggRltWhqsihzb0k-xvvPQeIG45FeVcbqB7F5_OMyJRzBchYXKehkOgWjergpJci6LeONjSeMPv8McxS8uvm3qLPtdbilbsYWFh8LhbOhoH7'

export default function TopAppBar({ showBack = false, onBack }) {
  return (
    <nav className="sticky top-0 z-50 bg-slate-50/70 backdrop-blur-lg flex justify-between items-center w-full px-6 py-4">
      <div className="flex items-center gap-3">
        {showBack ? (
          <button
            onClick={onBack}
            className="hover:opacity-80 transition-opacity active:scale-90 duration-300"
          >
            <span className="material-symbols-outlined text-on-surface">arrow_back</span>
          </button>
        ) : (
          <div className="w-10 h-10 rounded-full bg-surface-variant overflow-hidden">
            <img
              alt="User Profile"
              className="w-full h-full object-cover"
              src={AVATAR_URL}
            />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span
            className="material-symbols-outlined text-primary text-[22px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            brightness_high
          </span>
          <span className="text-lg font-extrabold text-slate-900 tracking-tight font-headline">
            Focus
          </span>
        </div>
      </div>
      <button className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:opacity-80 transition-opacity active:scale-90 duration-300">
        <span className="material-symbols-outlined">notifications</span>
      </button>
    </nav>
  )
}
