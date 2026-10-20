import { Icon } from './Shell.tsx';

/** A settings card's heading: icon tile, title, one line saying what the section is for. */
export const CardHead = ({ icon, title, desc }: { icon: string; title: string; desc: string }) => (
  <div className="sechead"><span className="secico"><Icon name={icon} /></span><div><h2>{title}</h2><span className="secdesc">{desc}</span></div></div>
);
