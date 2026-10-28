import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {CanvasDocuments,CanvasDocumentError} from "../src/canvas/index.js";
import {TrustedDataRoot,createWorkspaceDataScope,createStandaloneDataScope,
  openScopedDataDatabase} from "../src/scope/index.js";
import {SqliteStorageDriver} from "../src/storage/index.js";

const actor={kind:"human" as const,id:"ci-operator"};
let sequence=0;
const key=()=> "canvas-ci-"+(++sequence);
function fixture(action:(root:string,open:(workspaceId:string)=>ReturnType<typeof openScopedDataDatabase>)=>void){
  const root=mkdtempSync(join(tmpdir(),"aiverse-data-canvas-"));
  try{
    const trusted=TrustedDataRoot.fromExistingDirectory(root);
    const driver=new SqliteStorageDriver();
    const open=(workspaceId:string)=>{
      mkdirSync(join(root,"workspaces",workspaceId,"data"),{recursive:true});
      return openScopedDataDatabase(driver,createWorkspaceDataScope(trusted,workspaceId));
    };
    action(root,open);
  }finally{rmSync(root,{recursive:true,force:true})}
}
test("Canvas documents use canonical workspace Data records and survive reopening the actual database",()=>{
  fixture((_root,open)=>{
    const firstHandle=open("filmmaking");
    const first=new CanvasDocuments(firstHandle.database);
    assert.deepEqual(first.scope,{kind:"workspace",workspaceId:"filmmaking"});
    const created=first.create({title:"  Library tornado scene ",actor,idempotencyKey:key()});
    assert.equal(created.title,"Library tornado scene");
    assert.equal(created.version,1);
    assert.deepEqual(created.board,{nodes:[],edges:[]});
    const initialKey=key();
    let state=first.edit({id:created.id,expectedVersion:created.version,
      idempotencyKey:initialKey,actor,edit:{
        type:"note.add",id:"note-a",text:"Ariana in the wheel",x:50,y:25,
      }});
    state=first.edit({id:created.id,expectedVersion:state.version,
      idempotencyKey:key(),actor,edit:{
        type:"note.add",id:"note-b",text:"Tracking camera",x:250,y:125,
      }});
    state=first.edit({id:created.id,expectedVersion:state.version,
      idempotencyKey:key(),actor,edit:{
        type:"edge.add",id:"link-a-b",from:"note-a",to:"note-b",
      }});
    firstHandle.database.close();
    const secondHandle=open("filmmaking");
    const reopened=new CanvasDocuments(secondHandle.database);
    try{
      const saved=reopened.get(created.id);
      assert.equal(saved.version,4);
      assert.equal(saved.board.nodes.length,2);
      assert.equal(saved.board.edges.length,1);
      assert.deepEqual(reopened.list().map(x=>x.id),[created.id]);
      const moved=reopened.edit({id:created.id,expectedVersion:saved.version,
        idempotencyKey:key(),actor,edit:{type:"note.move",id:"note-a",x:91,y:-42}});
      assert.equal(moved.board.nodes[0]?.x,91);
      const renamed=reopened.rename({id:created.id,expectedVersion:moved.version,
        title:"Tornado camera study",idempotencyKey:key(),actor});
      assert.equal(renamed.title,"Tornado camera study");
      assert.equal(renamed.board.edges.length,1);
      assert.throws(()=>reopened.edit({id:created.id,expectedVersion:moved.version,
        idempotencyKey:key(),actor,edit:{type:"note.text",id:"note-a",text:"stale"}}),
        e=>(e as {code?:string}).code==="RECORD_VERSION_CONFLICT");
      const removed=reopened.edit({id:created.id,expectedVersion:renamed.version,
        idempotencyKey:key(),actor,edit:{type:"note.remove",id:"note-a"}});
      assert.equal(removed.board.nodes.length,1);
      assert.equal(removed.board.edges.length,0,"deleting a note also deletes its edges");
      const gone=reopened.delete({id:created.id,expectedVersion:removed.version,
        idempotencyKey:key(),actor});
      assert.equal(gone.id,created.id);
      assert.equal(reopened.list().length,0);
      assert.throws(()=>reopened.get(created.id),e=>(e as {code?:string}).code==="RECORD_NOT_FOUND");
    }finally{secondHandle.database.close();}
  });
});
test("Canvas Data owner scopes isolate workspaces and standalone Personal",()=>{
  fixture((root,open)=>{
    const primary=open("filmmaking");
    const other=open("client-private");
    mkdirSync(join(root,".ai-verse-data"),{recursive:true});
    const standalone=openScopedDataDatabase(new SqliteStorageDriver(),
      createStandaloneDataScope(TrustedDataRoot.fromExistingDirectory(root),"local"));
    try{
      const a=new CanvasDocuments(primary.database),b=new CanvasDocuments(other.database);
      const personal=new CanvasDocuments(standalone.database);
      const created=a.create({title:"Film board",actor,idempotencyKey:key()});
      const own=personal.create({title:"Personal Inbox Board",actor,idempotencyKey:key()});
      assert.equal(b.list().length,0);
      assert.equal(personal.list().length,1);
      assert.equal(a.list().length,1);
      assert.equal(personal.scope.workspaceId,"local");
      assert.equal(personal.scope.kind,"standalone");
      assert.throws(()=>b.get(created.id),e=>(e as {code?:string}).code==="RECORD_NOT_FOUND");
      assert.throws(()=>a.get(own.id),e=>(e as {code?:string}).code==="RECORD_NOT_FOUND");
    }finally{primary.database.close();other.database.close();standalone.database.close();}
  });
});
test("Canvas document input bounds, conflict controls and Data idempotency",()=>{
  fixture((_root,open)=>{
    const handle=open("alpha");
    try{
      const board=new CanvasDocuments(handle.database);
      assert.throws(()=>board.create({title:"",actor,idempotencyKey:key()}),
        e=>e instanceof CanvasDocumentError&&e.code==="CANVAS_TITLE_INVALID");
      const idempotencyKey=key();
      const item=board.create({title:"First",actor,idempotencyKey});
      assert.deepEqual(board.create({title:"First",actor,idempotencyKey}),item);
      assert.throws(()=>board.create({title:"Different",actor,idempotencyKey}),
        e=>(e as {code?:string}).code==="IDEMPOTENCY_CONFLICT");
      assert.throws(()=>board.edit({id:item.id,actor,expectedVersion:item.version,
        idempotencyKey:key(),edit:{type:"note.add",id:"bad/path",text:"",x:0,y:0}}),
        e=>e instanceof CanvasDocumentError&&e.code==="CANVAS_ID_INVALID");
      assert.throws(()=>board.edit({id:item.id,actor,expectedVersion:item.version,
        idempotencyKey:key(),edit:{type:"note.add",id:"good",text:"",x:Infinity,y:0}}),
        e=>e instanceof CanvasDocumentError&&e.code==="CANVAS_POSITION_INVALID");
      assert.throws(()=>board.edit({id:item.id,actor,expectedVersion:item.version,
        idempotencyKey:key(),edit:{type:"edge.add",id:"no-nodes",from:"a",to:"b"}}),
        e=>e instanceof CanvasDocumentError&&e.code==="CANVAS_EDGE_CONFLICT");
      assert.equal(board.get(item.id).version,1,"failed operations must not mutate records");
    }finally{handle.database.close()}
  });
});


test("Canvas duplicate is one atomic record, retains node graph, is idempotent and rejects stale sources",()=>{
 fixture((_root,open)=>{
  const handle=open("film");
  try{
   const owner=new CanvasDocuments(handle.database);
   const original=owner.create({title:"Storyboard",actor,idempotencyKey:key()});
   const withNote=owner.edit({id:original.id,expectedVersion:1,actor,idempotencyKey:key(),
     edit:{type:"note.add",id:"shot-1",text:"Camera A",x:50,y:90}});
   assert.equal(withNote.version,2);
   const withSecond=owner.edit({id:original.id,expectedVersion:2,actor,idempotencyKey:key(),
     edit:{type:"note.add",id:"shot-2",text:"Camera B",x:240,y:130}});
   assert.equal(withSecond.version,3);
   const linked=owner.edit({id:original.id,expectedVersion:3,actor,idempotencyKey:key(),
     edit:{type:"edge.add",id:"link-1",from:"shot-1",to:"shot-2"}});
   const cloneKey=key();
   const duplicate=owner.duplicate({id:original.id,expectedVersion:linked.version,
     title:"Storyboard copy",actor,idempotencyKey:cloneKey});
   assert.notEqual(duplicate.id,original.id);
   assert.equal(duplicate.version,1,"atomic copy is a single Data record create");
   assert.deepEqual(duplicate.board,linked.board);
   assert.equal(duplicate.title,"Storyboard copy");
   assert.deepEqual(owner.duplicate({id:original.id,expectedVersion:linked.version,
     title:"Storyboard copy",actor,idempotencyKey:cloneKey}),duplicate);
   assert.equal(owner.list().length,2,"no partial or repeated copies");
   assert.throws(()=>owner.duplicate({id:original.id,expectedVersion:linked.version,
     title:"Changed retry",actor,idempotencyKey:cloneKey}),
     e=>(e as {code?:string}).code==="IDEMPOTENCY_CONFLICT");
   const after=owner.rename({id:original.id,expectedVersion:linked.version,
     title:"Original changed",actor,idempotencyKey:key()});
   assert.equal(after.version,linked.version+1);
   assert.deepEqual(owner.duplicate({id:original.id,expectedVersion:linked.version,
     title:"Storyboard copy",actor,idempotencyKey:cloneKey}),duplicate,
     "committed clone replay is stable even when source advances");
   assert.throws(()=>owner.duplicate({id:original.id,expectedVersion:linked.version,
     actor,idempotencyKey:key()}),
     e=>(e as {code?:string}).code==="RECORD_VERSION_CONFLICT");
   assert.equal(owner.list().length,2);
   assert.equal(owner.get(duplicate.id).board.edges.length,1);
  }finally{handle.database.close()}
 });
});

test("Canvas true historical undo creates a new canonical version and survives SQLite restart",()=>{
  fixture((_root,open)=>{
    const firstHandle=open("filmmaking");
    const owner=new CanvasDocuments(firstHandle.database);
    const created=owner.create({title:"Opening",actor,idempotencyKey:key()});
    const added=owner.edit({id:created.id,expectedVersion:1,actor,idempotencyKey:key(),
      edit:{type:"note.add",id:"start",text:"Start",x:10,y:10}});
    const renamed=owner.rename({id:created.id,expectedVersion:2,actor,
      idempotencyKey:key(),title:"New heading"});
    const history=owner.history(created.id,10);
    assert.deepEqual(history.map(x=>x.version),[3,2,1]);
    assert.equal(history[1].board.nodes[0]?.text,"Start");
    assert.equal(history[2].board.nodes.length,0);
    assert.equal(history[0].title,"New heading");
    const undoKey=key();
    const undone=owner.revert({id:created.id,toVersion:1,expectedVersion:3,
      actor,idempotencyKey:undoKey});
    assert.equal(undone.version,4);
    assert.equal(undone.title,"Opening");
    assert.equal(undone.board.nodes.length,0);
    assert.deepEqual(owner.revert({id:created.id,toVersion:1,expectedVersion:3,
      actor,idempotencyKey:undoKey}),undone,
      "same operation retries after current version advances");
    assert.throws(()=>owner.revert({id:created.id,toVersion:1,expectedVersion:3,
      actor,idempotencyKey:key()}),e=>(e as {code?:string}).code==="RECORD_VERSION_CONFLICT");
    assert.throws(()=>owner.revert({id:created.id,toVersion:5,expectedVersion:4,
      actor,idempotencyKey:key()}),e=>(e as {code?:string}).code==="CANVAS_VERSION_INVALID");
    assert.throws(()=>owner.revert({id:created.id,toVersion:1,expectedVersion:3,
      actor,idempotencyKey:undoKey+"-other"}),e=>(e as {code?:string}).code==="RECORD_VERSION_CONFLICT");
    firstHandle.database.close();
    const reopened=open("filmmaking");
    try{
      const after=new CanvasDocuments(reopened.database);
      assert.deepEqual(after.history(created.id,10).map(x=>x.version),[4,3,2,1]);
      assert.deepEqual(after.get(created.id),undone);
      assert.equal(after.history(created.id,1)[0]?.version,4);
      assert.equal(added.version,2);assert.equal(renamed.version,3);
    }finally{reopened.database.close()}
  });
});
test("Canvas history is scoped, refuses nonexistent historical versions and deleted documents",()=>{
  fixture((_root,open)=>{
    const a=open("filmmaking"),b=open("other");
    try{
      const first=new CanvasDocuments(a.database),other=new CanvasDocuments(b.database);
      const x=first.create({title:"Original",actor,idempotencyKey:key()});
      assert.deepEqual(other.list(),[]);
      assert.throws(()=>other.history(x.id),e=>(e as {code?:string}).code==="RECORD_NOT_FOUND");
      assert.throws(()=>other.revert({id:x.id,toVersion:1,expectedVersion:2,
        actor,idempotencyKey:key()}),e=>(e as {code?:string}).code==="RECORD_NOT_FOUND");
      const edited=first.rename({id:x.id,expectedVersion:1,actor,
        idempotencyKey:key(),title:"New"});
      assert.throws(()=>first.revert({id:x.id,toVersion:99,expectedVersion:2,
        actor,idempotencyKey:key()}),e=>(e as {code?:string}).code==="CANVAS_VERSION_INVALID");
      assert.throws(()=>first.history(x.id,31),
        e=>(e as {code?:string}).code==="CANVAS_PAGE_INVALID");
      first.delete({id:x.id,expectedVersion:edited.version,actor,idempotencyKey:key()});
      assert.throws(()=>first.history(x.id),e=>(e as {code?:string}).code==="RECORD_NOT_FOUND");
      assert.throws(()=>first.revert({id:x.id,toVersion:1,expectedVersion:3,
        actor,idempotencyKey:key()}),e=>(e as {code?:string}).code==="RECORD_NOT_FOUND");
    }finally{a.database.close();b.database.close()}
  });
});
