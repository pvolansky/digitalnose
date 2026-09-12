'use client';
import {useActionState} from 'react';
import {createSite} from '@/app/settings/actions';
export function CreateSite(){const [state,action,pending]=useActionState(createSite,{});return <section className="form"><p className="eyebrow">Your first space</p><h1>Start with a place.</h1><p className="muted">Create a site for your sensor and resident observations. Joining an existing household? Ask its owner to add your registered email in Settings.</p><form action={action} className="stack"><div><label htmlFor="name">Site name</label><input id="name" name="name" placeholder="Home · Living room" required maxLength={100}/></div>{state.error&&<p role="alert" className="error">{state.error}</p>}<button disabled={pending}>{pending?'Creating…':'Create site'}</button></form></section>}
